import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { APIError } from "@vercel/sandbox";
import { StyledError } from "../../src/error";
import { CliError } from "../../src/util/cli-error";

const { mockCreate, mockGet, mockExec, mockInferScope, mockLogin } = vi.hoisted(
  () => ({
    mockCreate: vi.fn(),
    mockGet: vi.fn(),
    mockExec: vi.fn(),
    mockInferScope: vi.fn(),
    mockLogin: vi.fn(),
  }),
);
vi.mock("../../src/client", () => ({
  sandboxClient: { create: mockCreate, get: mockGet },
}));
vi.mock("../../src/commands/exec", () => ({
  exec: { handler: mockExec },
  args: {
    command: cmd.positional({ displayName: "command" }),
    args: cmd.rest({ displayName: "args" }),
  },
}));
vi.mock("../../src/util/infer-scope", () => ({ inferScope: mockInferScope }));
vi.mock("../../src/commands/login", () => ({ login: { handler: mockLogin } }));
vi.mock("../../src/telemetry/agent", () => ({
  detectAgentName: async () => undefined,
}));
vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));

describe("managed credential commands", () => {
  let directory: string;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("__VERCEL_SANDBOX_MANAGED_CREDENTIALS", undefined);
    vi.stubEnv("VERCEL_AUTH_TOKEN", "test-token");
    directory = await mkdtemp(join(tmpdir(), "sandbox-create-credentials-"));
    stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    mockCreate.mockResolvedValue({
      name: "new-sandbox",
      interactivePort: 8443,
      routes: [],
      currentSession: () => ({ sessionId: "sbx_123", status: "running" }),
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  const createWith = async (options: string[]) => {
    const { create } = await import("../../src/commands/create");
    return cmd.run(create, ["--scope=team", "--project=project", ...options]);
  };

  test("forwards repeated options as one group and previews implicit Git write access", async () => {
    await createWith([
      "--git-source=https://github.com/acme/widgets.git",
      "--commit-as-name=Grace Hopper",
      "--commit-as-email=grace@example.com",
      "--github-repository=acme/widgets",
      "--github-repository=acme/reference",
      "--github-action=github:issues:read",
      "--github-action=github:pull-request:create",
      "--github-act-as=42",
      "--yes",
      "--silent",
    ]);
    expect(mockCreate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        source: { type: "git", url: "https://github.com/acme/widgets.git" },
        commitAs: { name: "Grace Hopper", email: "grace@example.com" },
        credentials: {
          github: [
            {
              repositories: ["acme/widgets", "acme/reference"],
              actions: ["github:issues:read", "github:pull-request:create"],
              actAs: "42",
            },
          ],
        },
      }),
    );
    expect(stderr.mock.calls.flat().join("")).toContain(
      "acme/widgets: git:write",
    );
    expect(stdout).not.toHaveBeenCalled();
  });

  test.each(["grace", "@grace"])(
    "forwards and previews username %s",
    async (username) => {
      await createWith([
        "--github-repository=acme/widgets",
        "--github-action=github:issues:read",
        `--github-act-as=${username}`,
        "--yes",
        "--silent",
      ]);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: {
            github: [
              {
                repositories: ["acme/widgets"],
                actions: ["github:issues:read"],
                actAs: "@grace",
              },
            ],
          },
        }),
      );
      expect(stderr.mock.calls.flat().join("")).toContain("GitHub user @grace");
    },
  );

  test("--commit-as-me forwards the global Git identity", async () => {
    const config = join(directory, "gitconfig");
    await writeFile(
      config,
      "[user]\n name = Grace Hopper\n email = grace@example.com\n",
    );
    vi.stubEnv("GIT_CONFIG_GLOBAL", config);
    await createWith([
      "--git-source=https://github.com/acme/widgets.git",
      "--commit-as-me",
      "--yes",
      "--silent",
    ]);
    expect(mockCreate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        source: { type: "git", url: "https://github.com/acme/widgets.git" },
        commitAs: { name: "Grace Hopper", email: "grace@example.com" },
      }),
    );
    expect(stderr.mock.calls.flat().join("")).toContain(
      "Grace Hopper <grace@example.com>",
    );
  });

  test.each(["--commit-as-name=Grace", "--commit-as-email=grace@example.com"])(
    "--commit-as-me conflicts with %s before creation",
    async (option) => {
      await expect(
        createWith([
          "--git-source=https://github.com/acme/widgets.git",
          "--commit-as-me",
          option,
          "--yes",
        ]),
      ).rejects.toThrow("--commit-as-me cannot be combined");
      expect(mockCreate).not.toHaveBeenCalled();
    },
  );

  test("tooling without a source creates an explicit empty list", async () => {
    await createWith(["--github", "--yes", "--silent"]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { github: [] },
        source: undefined,
        commitAs: undefined,
      }),
    );
  });

  test("JSON output contains only the result and no request credentials", async () => {
    await createWith(["--github", "--yes", "--json"]);
    const result = JSON.parse(
      stdout.mock.calls.map((call) => call[0]).join(""),
    );
    expect(result).toMatchObject({
      sandbox: { name: "new-sandbox" },
      session: { id: "sbx_123", status: "running" },
      outcome: "created",
    });
    expect(result.next[0].argv).toEqual([
      "sandbox",
      "config",
      "list",
      "new-sandbox",
      "--scope",
      "team",
      "--project",
      "project",
    ]);
    expect(JSON.stringify(result)).not.toContain("credentials");
    expect(stderr).not.toHaveBeenCalled();
  });

  test("JSON selects a format, never consent", async () => {
    await expect(createWith(["--github", "--json"])).rejects.toMatchObject({
      options: {
        reason: "confirmation_required",
        json: true,
        userActionRequired: true,
      },
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  test("missing consent fails in non-interactive mode even with --silent", async () => {
    await expect(
      createWith(["--github", "--non-interactive", "--silent"]),
    ).rejects.toMatchObject({ options: { reason: "confirmation_required" } });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(stderr.mock.calls.flat().join("")).toContain(
      "No initial GitHub API repository grants",
    );
  });

  test("invalid inputs fail before auth, scope inference or creation", async () => {
    vi.stubEnv("VERCEL_AUTH_TOKEN", "");
    const { create } = await import("../../src/commands/create");
    await expect(
      cmd.run(create, ["--commit-as-name=Grace", "--yes"]),
    ).rejects.toThrow("both --commit-as-name");
    expect(mockInferScope).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("file input passes multiple independent groups unchanged", async () => {
    const credentials = {
      github: [
        {
          repositories: ["acme/widgets"],
          actions: ["github:issues:read"],
          actAs: "42",
        },
        {
          repositories: ["acme/reference"],
          actions: ["github:pull-request:create"],
          actAs: "43",
        },
      ],
    };
    const file = join(directory, "create.json");
    await writeFile(file, JSON.stringify({ credentials }));
    await createWith(["--managed-credentials-file", file, "--yes", "--silent"]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ credentials }),
    );
  });

  test("snapshot sources keep GitHub forwarding but reject a commit identity", async () => {
    await createWith(["--snapshot=snap_123", "--github", "--yes", "--silent"]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { type: "snapshot", snapshotId: "snap_123" },
        credentials: { github: [] },
      }),
    );
    mockCreate.mockClear();
    await expect(
      createWith([
        "--snapshot=snap_123",
        "--git-source=https://github.com/acme/widgets.git",
      ]),
    ).rejects.toThrow("cannot be combined");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("a failed creation is not reported as completed in JSON", async () => {
    mockCreate.mockRejectedValueOnce(new Error("secret-value"));
    const error = await createWith(["--github", "--yes", "--json"]).catch(
      (error) => error,
    );
    expect(error).toBeInstanceOf(CliError);
    expect(error.options).toMatchObject({
      reason: "unknown_outcome",
      json: true,
      exitCode: 1,
    });
    expect(error.message).not.toContain("secret-value");
    expect(stdout).not.toHaveBeenCalled();
  });

  test("run rejects creation inputs on an existing sandbox before resuming", async () => {
    mockGet.mockResolvedValueOnce({ name: "existing" });
    const { run } = await import("../../src/commands/run");
    await expect(
      cmd.run(run, [
        "--scope=team",
        "--project=project",
        "--name=existing",
        "--github",
        "--yes",
        "--",
        "echo",
        "hello",
      ]),
    ).rejects.toThrow("already exists");
    expect(mockGet).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "existing", resume: false }),
    );
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  test("run forwards creation inputs only after a 404", async () => {
    const response = new Response("{}", { status: 404 });
    mockGet.mockRejectedValueOnce(
      new StyledError("missing", new APIError(response)),
    );
    const { run } = await import("../../src/commands/run");
    await cmd.run(run, [
      "--scope=team",
      "--project=project",
      "--name=new",
      "--github",
      "--yes",
      "--silent",
      "--",
      "echo",
      "hello",
    ]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { github: [] } }),
    );
    expect(mockExec).toHaveBeenCalledOnce();
  });

  test("run accepts usernames from --managed-credentials-file", async () => {
    const file = join(directory, "run-credentials.json");
    await writeFile(
      file,
      JSON.stringify({
        credentials: {
          github: [
            {
              repositories: ["acme/widgets"],
              actions: ["github:issues:read"],
              actAs: "grace",
            },
          ],
        },
      }),
    );
    const { run } = await import("../../src/commands/run");
    await cmd.run(run, [
      "--scope=team",
      "--project=project",
      `--managed-credentials-file=${file}`,
      "--yes",
      "--silent",
      "--",
      "echo",
      "hello",
    ]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          github: [
            {
              repositories: ["acme/widgets"],
              actions: ["github:issues:read"],
              actAs: "@grace",
            },
          ],
        },
      }),
    );
    expect(mockExec).toHaveBeenCalledOnce();
  });
});
