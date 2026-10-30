import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CliError } from "../../src/util/cli-error";

const {
  mockCreate,
  mockGet,
  mockExec,
  mockInferScope,
  mockLogin,
  mockInferRepository,
  mockInferCommitIdentity,
  mockInferActor,
  mockVersionCheck,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockExec: vi.fn(),
  mockInferScope: vi.fn(),
  mockLogin: vi.fn(),
  mockInferRepository: vi.fn(),
  mockInferCommitIdentity: vi.fn(),
  mockInferActor: vi.fn(),
  mockVersionCheck: vi.fn(() => ({ report() {} })),
}));

vi.mock("../../src/client", () => ({
  sandboxClient: { create: mockCreate, get: mockGet },
}));
vi.mock("../../src/util/check-latest-version", () => ({
  startLatestVersionCheck: mockVersionCheck,
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

// Local tool discovery is mocked so the suite never depends on the machine's
// Git remotes, Git identity, or gh login state. The precedence between gh and
// the Vercel account link is covered in
// test/util/managed-credentials-actor.test.ts against the real resolver.
vi.mock("../../src/util/managed-credentials-repository", () => ({
  inferRepository: mockInferRepository,
}));
vi.mock("../../src/util/managed-credentials-actor", () => ({
  inferActor: mockInferActor,
}));
vi.mock("../../src/util/managed-credentials-commit", async (original) => ({
  ...(await original<
    typeof import("../../src/util/managed-credentials-commit")
  >()),
  inferCommitIdentity: mockInferCommitIdentity,
}));

describe("create with managed credentials", () => {
  let directory: string;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_AUTH_TOKEN", "test-token");
    directory = await mkdtemp(join(tmpdir(), "sandbox-managed-credentials-"));
    stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    mockCreate.mockResolvedValue({
      name: "new-sandbox",
      interactivePort: 8443,
      routes: [],
      currentSession: () => ({ sessionId: "sbx_132456789", status: "running" }),
    });
    mockInferRepository.mockResolvedValue("vercel/api");
    mockInferCommitIdentity.mockResolvedValue({
      name: "Jack Jackson",
      email: "scubbojj@gmail.com",
    });
    mockInferActor.mockResolvedValue({
      actAs: "2373726",
      login: "scubbo",
      source: "gh",
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

  const errText = () => stderr.mock.calls.flat().join("");

  describe("bare create", () => {
    test("requests no managed credentials and keeps default resources", async () => {
      await createWith(["--silent"]);
      const params = mockCreate.mock.calls[0][0];
      expect(params.commitAs).toBeUndefined();
      expect(params.credentials).toBeUndefined();
      expect(params.source).toBeUndefined();
      // Six vCPUs is a managed-credentials workaround, not a new global
      // default.
      expect(params.resources).toBeUndefined();
    });

    test("does not consult local Git or gh", async () => {
      await createWith(["--silent"]);
      expect(mockInferRepository).not.toHaveBeenCalled();
      expect(mockInferActor).not.toHaveBeenCalled();
    });
  });

  describe("opt-in defaults", () => {
    test("sends the inferred source, identity, actions, and six vCPUs", async () => {
      await createWith(["--enable-managed-credentials", "--yes", "--silent"]);
      expect(mockCreate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          source: {
            type: "git",
            url: "https://github.com/vercel/api.git",
            credentials: true,
          },
          commitAs: { name: "Jack Jackson", email: "scubbojj@gmail.com" },
          credentials: {
            github: [
              {
                repositories: ["vercel/api"],
                actions: [
                  "github:issues:read",
                  "github:issues:comment",
                  "github:pull-request:create",
                ],
                actAs: "2373726",
              },
            ],
          },
          resources: { vcpus: 6 },
        }),
      );
    });

    test("an explicit --vcpus overrides the managed default", async () => {
      await createWith([
        "--enable-managed-credentials",
        "--vcpus=2",
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].resources).toEqual({ vcpus: 2 });
    });

    test("direct flags activate without a separate enable flag", async () => {
      await createWith([
        "--credentials-action=issues:read",
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].credentials).toEqual({
        github: [
          {
            repositories: ["vercel/api"],
            actions: ["github:issues:read"],
            actAs: "2373726",
          },
        ],
      });
    });

    test("supplied actions replace the defaults", async () => {
      await createWith([
        "--credentials-action=labels:read",
        "--credentials-action=labels:write",
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].credentials.github[0].actions).toEqual(
        ["github:labels:read", "github:labels:write"],
      );
    });

    test("Git write stays the default when actions are overridden", async () => {
      await createWith([
        "--credentials-action=issues:read",
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].source.credentials).toBe(true);
      expect(mockCreate.mock.calls[0][0].commitAs).toBeDefined();
    });

    test("an explicit commit identity overrides local Git configuration", async () => {
      await createWith([
        "--credentials-commit-as=Jack Jackson <myotheremail@scubbo.org>",
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].commitAs).toEqual({
        name: "Jack Jackson",
        email: "myotheremail@scubbo.org",
      });
    });

    test("passes an explicit actor through as the explicit value", async () => {
      mockInferActor.mockResolvedValue({
        actAs: "123456",
        source: "explicit",
      });
      await createWith(["--credentials-act-as=123456", "--yes", "--silent"]);
      expect(mockInferActor).toHaveBeenCalledWith(
        expect.objectContaining({ explicit: "123456" }),
      );
      expect(mockCreate.mock.calls[0][0].credentials.github[0].actAs).toBe(
        "123456",
      );
    });

    test("an explicit repository overrides the local remote", async () => {
      await createWith([
        "--credentials-repo=acme/widgets",
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].source.url).toBe(
        "https://github.com/acme/widgets.git",
      );
      expect(mockInferRepository).not.toHaveBeenCalled();
    });
  });

  describe("--credentials-no-write", () => {
    test("requests a read-only clone and sends no commit metadata", async () => {
      await createWith([
        "--enable-managed-credentials",
        "--credentials-no-write",
        "--yes",
        "--silent",
      ]);
      const params = mockCreate.mock.calls[0][0];
      expect(params.source.credentials).toBe("read");
      expect(params.commitAs).toBeUndefined();
    });

    test("keeps requested API actions as writes", async () => {
      await createWith([
        "--credentials-action=issues:comment",
        "--credentials-action=pull-request:create",
        "--credentials-no-write",
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].credentials.github[0].actions).toEqual(
        ["github:issues:comment", "github:pull-request:create"],
      );
    });
  });

  describe("identity resolution", () => {
    test("sends the resolved actor as the API identity", async () => {
      mockInferActor.mockResolvedValue({
        actAs: "@scubbo",
        login: "scubbo",
        source: "vercel-account-link",
      });
      await createWith(["--enable-managed-credentials", "--yes", "--silent"]);
      expect(mockCreate.mock.calls[0][0].credentials.github[0].actAs).toBe(
        "@scubbo",
      );
    });

    test("creates nothing when actor resolution fails", async () => {
      mockInferActor.mockRejectedValue(
        new CliError("gh is logged in but `gh api user` failed."),
      );
      await expect(
        createWith(["--enable-managed-credentials", "--yes", "--silent"]),
      ).rejects.toThrow(/gh api user/);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test("creates nothing when no actor can be resolved", async () => {
      mockInferActor.mockResolvedValue(undefined);
      await expect(
        createWith(["--enable-managed-credentials", "--yes", "--silent"]),
      ).rejects.toThrow(/Can't resolve the GitHub account/);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("configuration files", () => {
    const writeConfig = async (value: unknown) => {
      const path = join(directory, "config.json");
      await writeFile(path, JSON.stringify(value), "utf8");
      return path;
    };

    test("sends multiple repositories with their own identities", async () => {
      const path = await writeConfig({
        source: { repo: "vercel/infra" },
        commitAs: { name: "John Fakenameson", email: "madeup@example.org" },
        credentials: {
          github: [
            {
              repo: "vercel/infra",
              actions: ["git:read"],
              actAs: "@some-alias",
            },
            {
              repo: "vercel/front",
              actions: ["issues:comment", "pull-request:create"],
              actAs: "@fake-alias",
            },
            {
              repo: "vercel/another-repo",
              actions: ["issues:read"],
              actAs: 123456,
            },
          ],
        },
      });

      await createWith([
        `--credentials-from-config-file=${path}`,
        "--yes",
        "--silent",
      ]);

      const params = mockCreate.mock.calls[0][0];
      expect(params.source).toEqual({
        type: "git",
        url: "https://github.com/vercel/infra.git",
        credentials: "read",
      });
      // Commit metadata is inert without Git write and must not upgrade the
      // read-only source.
      expect(params.commitAs).toBeUndefined();
      expect(params.credentials.github).toEqual([
        {
          repositories: ["vercel/front"],
          actions: ["github:issues:comment", "github:pull-request:create"],
          actAs: "@fake-alias",
        },
        {
          repositories: ["vercel/another-repo"],
          actions: ["github:issues:read"],
          actAs: "123456",
        },
      ]);
    });

    test("an empty github array acquires no default actions", async () => {
      const path = await writeConfig({ credentials: { github: [] } });
      await createWith([
        `--credentials-from-config-file=${path}`,
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].credentials).toEqual({ github: [] });
      expect(mockCreate.mock.calls[0][0].commitAs).toBeUndefined();
    });

    test("does not consult local Git or gh for an explicit configuration", async () => {
      const path = await writeConfig({ credentials: { github: [] } });
      await createWith([
        `--credentials-from-config-file=${path}`,
        "--yes",
        "--silent",
      ]);
      expect(mockInferRepository).not.toHaveBeenCalled();
      expect(mockInferActor).not.toHaveBeenCalled();
    });

    test("rejects combining a file with direct flags", async () => {
      const path = await writeConfig({ credentials: { github: [] } });
      await expect(
        createWith([
          `--credentials-from-config-file=${path}`,
          "--credentials-action=issues:read",
          "--yes",
        ]),
      ).rejects.toThrow(/cannot be combined with/);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test("rejects a malformed file before authenticating or creating", async () => {
      const path = join(directory, "bad.json");
      await writeFile(path, "{ not json", "utf8");
      await expect(
        createWith([`--credentials-from-config-file=${path}`, "--yes"]),
      ).rejects.toThrow(/valid UTF-8 JSON/);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("reuse from an existing sandbox", () => {
    test("copies configuration without resuming the source sandbox", async () => {
      mockGet.mockResolvedValue({
        currentSession: () => ({
          sessionId: "sbx_source",
          status: "stopped",
          managedCredentials: {
            source: {
              type: "git",
              url: "https://github.com/acme/widgets.git",
              credentials: true,
            },
            commitAs: { name: "Grace Hopper", email: "grace@example.com" },
            credentials: {
              github: [
                {
                  repositories: ["acme/widgets"],
                  actions: ["github:issues:read"],
                  actAs: "42",
                },
              ],
            },
          },
        }),
      });

      await createWith([
        "--credentials-from-sandbox=sbx_132456789",
        "--yes",
        "--silent",
      ]);

      expect(mockGet).toHaveBeenCalledWith(
        expect.objectContaining({ name: "sbx_132456789", resume: false }),
      );
      expect(mockCreate.mock.calls[0][0].credentials.github).toEqual([
        {
          repositories: ["acme/widgets"],
          actions: ["github:issues:read"],
          actAs: "42",
        },
      ]);
    });

    test("accepts a sandbox name", async () => {
      mockGet.mockResolvedValue({
        currentSession: () => ({
          sessionId: "sbx_source",
          status: "stopped",
          managedCredentials: { credentials: { github: [] } },
        }),
      });
      await createWith([
        "--credentials-from-sandbox=my-sandbox",
        "--yes",
        "--silent",
      ]);
      expect(mockGet).toHaveBeenCalledWith(
        expect.objectContaining({ name: "my-sandbox", resume: false }),
      );
    });

    test("reports a sandbox with no configuration to reuse", async () => {
      mockGet.mockResolvedValue({
        currentSession: () => ({ sessionId: "sbx_source", status: "stopped" }),
      });
      await expect(
        createWith(["--credentials-from-sandbox=plain", "--yes"]),
      ).rejects.toThrow(/does not report a managed-credentials configuration/);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("persistence", () => {
    test("writes the default file name from the returned sbx_ identifier", async () => {
      const cwd = vi.spyOn(process, "cwd").mockReturnValue(directory);
      try {
        await createWith([
          "--enable-managed-credentials",
          "--credentials-persist-configuration",
          "--yes",
          "--silent",
        ]);
      } finally {
        cwd.mockRestore();
      }

      const written = await readFile(
        join(directory, "sbx_132456789-credentials.json"),
        "utf8",
      );
      expect(JSON.parse(written)).toEqual({
        source: { repo: "vercel/api" },
        commitAs: { name: "Jack Jackson", email: "scubbojj@gmail.com" },
        credentials: {
          github: [
            {
              repo: "vercel/api",
              actions: [
                "github:issues:read",
                "github:issues:comment",
                "github:pull-request:create",
                "git:write",
              ],
              actAs: "2373726",
            },
          ],
        },
      });
    });

    test("writes an explicit path", async () => {
      const path = join(directory, "explicit.json");
      await createWith([
        "--enable-managed-credentials",
        `--credentials-persist-configuration=${path}`,
        "--yes",
        "--silent",
      ]);
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
        source: { repo: "vercel/api" },
      });
    });

    test("round-trips: a persisted file replays to the same request", async () => {
      const path = join(directory, "round-trip.json");
      await createWith([
        "--enable-managed-credentials",
        `--credentials-persist-configuration=${path}`,
        "--yes",
        "--silent",
      ]);
      const first = mockCreate.mock.calls[0][0];

      mockCreate.mockClear();
      await createWith([
        `--credentials-from-config-file=${path}`,
        "--yes",
        "--silent",
      ]);
      const second = mockCreate.mock.calls[0][0];

      expect(second.source).toEqual(first.source);
      expect(second.commitAs).toEqual(first.commitAs);
      expect(second.credentials).toEqual(first.credentials);
    });

    test("reports the created sandbox when the local write fails", async () => {
      const path = join(directory, "taken.json");
      await writeFile(path, "user data", "utf8");

      await expect(
        createWith([
          "--enable-managed-credentials",
          `--credentials-persist-configuration=${path}`,
          "--yes",
          "--silent",
        ]),
      ).rejects.toMatchObject({
        message: expect.stringContaining("new-sandbox"),
      });

      // The sandbox was created once; a local write failure must never cause
      // another creation attempt.
      expect(mockCreate).toHaveBeenCalledOnce();
      expect(await readFile(path, "utf8")).toBe("user data");
    });

    test("rejects persisting when no configuration was requested", async () => {
      // Otherwise the command would succeed having written nothing.
      await expect(
        createWith([
          `--credentials-persist-configuration=${join(directory, "x.json")}`,
          "--yes",
          "--silent",
        ]),
      ).rejects.toThrow(/but none was requested/);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test("explains that the path needs an equals sign", async () => {
      // `--flag path` leaves the path as a positional, which would otherwise
      // fail against the agent shortcut with an unrelated message.
      await expect(
        createWith([
          "--enable-managed-credentials",
          "--credentials-persist-configuration",
          join(directory, "out.json"),
          "--yes",
        ]),
      ).rejects.toThrow(/takes its path with an equals sign/);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test("still reports a repeated option by name", async () => {
      await expect(
        createWith([
          "--credentials-repo=acme/one",
          "--credentials-repo=acme/two",
          "--yes",
        ]),
      ).rejects.toThrow(/--credentials-repo/);
    });

    test("does not write a file when creation fails", async () => {
      mockCreate.mockRejectedValue(new Error("creation rejected"));
      const path = join(directory, "never.json");
      await expect(
        createWith([
          "--enable-managed-credentials",
          `--credentials-persist-configuration=${path}`,
          "--yes",
          "--silent",
        ]),
      ).rejects.toThrow();
      await expect(readFile(path, "utf8")).rejects.toThrow();
    });
  });

  describe("--dry-run", () => {
    test("creates nothing and writes no configuration file", async () => {
      const path = join(directory, "dry.json");
      await createWith([
        "--enable-managed-credentials",
        `--credentials-persist-configuration=${path}`,
        "--dry-run",
        "--yes",
      ]);
      expect(mockCreate).not.toHaveBeenCalled();
      await expect(readFile(path, "utf8")).rejects.toThrow();
      expect(errText()).toContain("Dry run");
    });

    test("shows the proposal without requiring approval", async () => {
      await createWith(["--enable-managed-credentials", "--dry-run"]);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(errText()).toContain("vercel/api");
      expect(errText()).toContain("git:write");
    });

    test("creates nothing even without managed credentials", async () => {
      await createWith(["--dry-run"]);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockVersionCheck).not.toHaveBeenCalled();
    });
  });

  describe("consent in non-interactive runs", () => {
    test("requires --yes before creating", async () => {
      await expect(
        createWith(["--enable-managed-credentials", "--silent"]),
      ).rejects.toMatchObject({ options: { reason: "confirmation_required" } });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test("shows the proposal before refusing", async () => {
      await createWith(["--enable-managed-credentials", "--silent"]).catch(
        () => undefined,
      );
      expect(errText()).toContain("Managed credentials for this sandbox");
      expect(errText()).toContain("Commit credit");
      expect(errText()).toContain("API actor");
    });

    test("--json does not prompt and does not grant consent", async () => {
      await expect(
        createWith(["--enable-managed-credentials", "--json"]),
      ).rejects.toMatchObject({ options: { reason: "confirmation_required" } });
      expect(stdout).not.toHaveBeenCalled();
    });

    test("--silent does not suppress the proposal", async () => {
      await createWith(["--enable-managed-credentials", "--silent", "--yes"]);
      expect(errText()).toContain("Managed credentials for this sandbox");
    });
  });

  describe("creation failures", () => {
    test.each(["run", "sh"])(
      "%s rejects dry-run without starting anything",
      async (name) => {
        const module =
          name === "run"
            ? await import("../../src/commands/run")
            : await import("../../src/commands/sh");
        const command = "run" in module ? module.run : module.sh;
        await expect(
          cmd.run(command as typeof import("../../src/commands/sh").sh, [
            "--scope=team",
            "--project=project",
            "--dry-run",
            ...(name === "run" ? ["echo", "hello"] : []),
          ]),
        ).rejects.toThrow("--dry-run");
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockExec).not.toHaveBeenCalled();
      },
    );
    test("run never resumes an existing sandbox to change its credentials", async () => {
      const { run } = await import("../../src/commands/run");
      mockGet.mockResolvedValue({ name: "existing" });
      await expect(
        cmd.run(run, [
          "--scope=team",
          "--project=project",
          "--name=existing",
          "--enable-managed-credentials",
          "--yes",
          "echo",
        ]),
      ).rejects.toThrow("already exists");
      expect(mockGet).toHaveBeenCalledWith(
        expect.objectContaining({ resume: false }),
      );
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockExec).not.toHaveBeenCalled();
    });
    test("does not retry a rejected creation", async () => {
      mockCreate.mockRejectedValue(new Error("rejected"));
      await expect(
        createWith(["--enable-managed-credentials", "--yes", "--silent"]),
      ).rejects.toThrow();
      expect(mockCreate).toHaveBeenCalledOnce();
    });
  });
});
