import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import * as cmd from "cmd-ts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CliError } from "../../src/util/cli-error";
import { APIError, GITHUB_API_CREDENTIAL_ACTIONS } from "@vercel/sandbox";

const {
  mockCreate,
  mockGet,
  mockExec,
  mockInferScope,
  mockLogin,
  mockInferRepository,
  mockInferActor,
  mockVersionCheck,
  mockHasProjectBounds,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockExec: vi.fn(),
  mockInferScope: vi.fn(),
  mockLogin: vi.fn(),
  mockInferRepository: vi.fn(),
  mockInferActor: vi.fn(),
  mockVersionCheck: vi.fn(() => ({ report() {} })),
  mockHasProjectBounds: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  sandboxClient: { create: mockCreate, get: mockGet },
}));
vi.mock("../../src/util/check-latest-version", () => ({
  startLatestVersionCheck: mockVersionCheck,
}));
vi.mock("../../src/util/managed-credentials-project-bounds", () => ({
  hasProjectBounds: mockHasProjectBounds,
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

describe("create with managed credentials", () => {
  let directory: string;
  let stdout: MockInstance<typeof process.stdout.write>;
  let stderr: MockInstance<typeof process.stderr.write>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockHasProjectBounds.mockResolvedValue(true);
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

  // This suite is the command wiring layer: it asserts that each behavior
  // reaches Sandbox.create, the filesystem or the error path correctly. The
  // input matrices themselves belong to the unit suites that own them
  // (managed-credentials-resolve, -config, -flow, -persist, -project-bounds,
  // create-rejection), which this file deliberately does not re-run.

  describe("project Bounds", () => {
    test("JSON --yes keeps the warning on stderr and the creation result on stdout", async () => {
      mockHasProjectBounds.mockResolvedValue(false);
      await createWith(["--enable-github-credentials", "--yes", "--json"]);
      expect(JSON.parse(errText())).toMatchObject({
        status: "warning",
        reason: "project_has_no_bounds",
      });
      expect(JSON.parse(stdout.mock.calls.flat().join(""))).toMatchObject({
        outcome: "created",
        sandbox: { name: "new-sandbox" },
      });
      expect(mockCreate).toHaveBeenCalledOnce();
    });
  });

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

  describe("requested access reaches the API", () => {
    test("sends the inferred source, identity, actions, and six vCPUs", async () => {
      await createWith(["--enable-github-credentials", "--yes", "--silent"]);
      expect(mockCreate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          source: {
            type: "git",
            url: "https://github.com/vercel/api.git",
          },
          commitAs: undefined,
          credentials: {
            github: [
              {
                repositories: ["vercel/api"],
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
          resources: { vcpus: 6 },
        }),
      );
    });

    test("an explicit --vcpus overrides the managed default", async () => {
      await createWith([
        "--enable-github-credentials",
        "--vcpus=2",
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].resources).toEqual({ vcpus: 2 });
    });

    test("creates nothing when no actor can be resolved", async () => {
      mockInferActor.mockResolvedValue(undefined);
      await expect(
        createWith(["--enable-github-credentials", "--yes", "--silent"]),
      ).rejects.toThrow(/Can't resolve the GitHub account/);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("configuration input", () => {
    const writeConfig = async (value: unknown) => {
      const path = join(directory, "config.json");
      await writeFile(path, JSON.stringify(value), "utf8");
      return path;
    };

    test("sends multiple repositories with their own identities", async () => {
      const path = await writeConfig({
        source: { type: "git", url: "https://github.com/vercel/infra.git" },
        credentials: {
          github: [
            {
              repositories: ["vercel/infra"],
              actions: ["git:write-workflows"],
              actAs: "@some-alias",
            },
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
          ],
        },
      });

      await createWith([
        `--credentials-github-from-config-file=${path}`,
        "--yes",
        "--silent",
      ]);

      const params = mockCreate.mock.calls[0][0];
      expect(params.source).toEqual({
        type: "git",
        url: "https://github.com/vercel/infra.git",
      });
      // Attribution remains attached to each repository's selected actor.
      expect(params.commitAs).toBeUndefined();
      expect(params.credentials.github).toEqual([
        {
          repositories: ["vercel/infra"],
          actions: ["git:write-workflows"],
          actAs: "@some-alias",
        },
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
        "--credentials-github-from-sandbox=sbx_132456789",
        "--yes",
        "--silent",
      ]);

      expect(mockGet).toHaveBeenCalledWith(
        expect.objectContaining({ name: "sbx_132456789", resume: false }),
      );
      expect(mockCreate.mock.calls[0][0].credentials.github).toEqual([
        {
          repositories: ["acme/widgets"],
          actions: ["github:issues:read", "git:write"],
          actAs: "42",
        },
      ]);
    });
  });

  describe("persistence", () => {
    test("writes an explicit path", async () => {
      const path = join(directory, "explicit.json");
      await createWith([
        "--enable-github-credentials",
        `--credentials-github-persist-configuration=${path}`,
        "--yes",
        "--silent",
      ]);
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
        source: { type: "git", url: "https://github.com/vercel/api.git" },
      });
    });

    test("reports the created sandbox when the local write fails", async () => {
      const path = join(directory, "taken.json");
      await writeFile(path, "user data", "utf8");

      await expect(
        createWith([
          "--enable-github-credentials",
          `--credentials-github-persist-configuration=${path}`,
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

    test("does not write a file when creation fails", async () => {
      mockCreate.mockRejectedValue(new Error("creation rejected"));
      const path = join(directory, "never.json");
      await expect(
        createWith([
          "--enable-github-credentials",
          `--credentials-github-persist-configuration=${path}`,
          "--yes",
          "--silent",
        ]),
      ).rejects.toThrow();
      await expect(readFile(path, "utf8")).rejects.toThrow();
    });
  });

  describe("dry run and consent", () => {
    test("creates nothing and writes no configuration file", async () => {
      const path = join(directory, "dry.json");
      await createWith([
        "--enable-github-credentials",
        `--credentials-github-persist-configuration=${path}`,
        "--dry-run",
        "--yes",
      ]);
      expect(mockCreate).not.toHaveBeenCalled();
      await expect(readFile(path, "utf8")).rejects.toThrow();
      expect(errText()).toContain("Dry run");
    });

    test("requires --yes before creating", async () => {
      await expect(
        createWith(["--enable-github-credentials", "--silent"]),
      ).rejects.toMatchObject({ options: { reason: "confirmation_required" } });
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("creation failures", () => {
    test("reports unsupported backend action validation without exposing response contents", async () => {
      mockCreate.mockRejectedValue(
        new APIError(new Response(null, { status: 400 }), {
          json: {
            error: {
              code: "bad_request",
              message:
                'Invalid request: `credentials.github[0].actions[1]` should be equal to one of the allowed values "private-response-canary".',
            },
          },
          text: "private-response-canary",
        }),
      );
      const error = await createWith([
        "--credentials-github-action=git:write",
        "--yes",
        "--json",
      ]).catch((error) => error);
      expect(error).toBeInstanceOf(CliError);
      expect(error.message).toContain("HTTP 400, bad_request");
      expect(error.message).toContain("unified-credential backend");
      expect(error.message).not.toContain("private-response-canary");
      expect(error.options).toMatchObject({
        reason: "creation_failed",
        json: true,
        data: {
          status: 400,
          apiCode: "bad_request",
          apiReason: "unsupported_credential_action",
        },
      });
      expect(mockCreate).toHaveBeenCalledOnce();
      expect(stdout).not.toHaveBeenCalled();
    });

    test("does not suggest retrying creation after an uncertain server error", async () => {
      mockCreate.mockRejectedValue(
        new APIError(new Response(null, { status: 502 }), {
          json: {
            error: {
              code: "private-response-canary",
              message: "private-response-canary",
            },
          },
        }),
      );
      const error = await createWith([
        "--credentials-github-action=git:write",
        "--yes",
        "--json",
      ]).catch((error) => error);
      expect(error.options.reason).toBe("unknown_outcome");
      expect(error.message).toContain(
        "Inspect the sandbox list before retrying",
      );
      expect(error.options.data).not.toHaveProperty("apiCode");
      expect(error.message).not.toContain("private-response-canary");
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    test("run never resumes an existing sandbox to change its credentials", async () => {
      const { run } = await import("../../src/commands/run");
      mockGet.mockResolvedValue({ name: "existing" });
      await expect(
        cmd.run(run, [
          "--scope=team",
          "--project=project",
          "--name=existing",
          "--enable-github-credentials",
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
        createWith(["--enable-github-credentials", "--yes", "--silent"]),
      ).rejects.toThrow();
      expect(mockCreate).toHaveBeenCalledOnce();
    });
  });
});
