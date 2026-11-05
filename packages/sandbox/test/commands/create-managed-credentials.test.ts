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
  mockInferCommitIdentity,
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
  mockInferCommitIdentity: vi.fn(),
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
vi.mock("../../src/util/managed-credentials-commit", async (original) => ({
  ...(await original<
    typeof import("../../src/util/managed-credentials-commit")
  >()),
  inferCommitIdentity: mockInferCommitIdentity,
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

  describe("unbounded project warning", () => {
    test("--yes accepts the state but prints its warning before creation", async () => {
      mockHasProjectBounds.mockResolvedValue(false);
      await createWith(["--enable-github-credentials", "--yes", "--silent"]);
      expect(mockHasProjectBounds).toHaveBeenCalledExactlyOnceWith({
        token: "test-token",
        team: "team",
        project: "project",
      });
      expect(errText()).toContain("This project has no Bounds");
      expect(mockCreate).toHaveBeenCalledOnce();
      expect(stdout).not.toHaveBeenCalled();
    });

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

    test("an unreadable policy stops creation even with --yes", async () => {
      mockHasProjectBounds.mockRejectedValue(
        new CliError("Cannot read project Bounds", {
          reason: "policy_unknown",
        }),
      );
      await expect(
        createWith(["--enable-github-credentials", "--yes", "--json"]),
      ).rejects.toMatchObject({
        options: { reason: "policy_unknown", json: true },
      });
      expect(mockCreate).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
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

  describe("GitHub access presets", () => {
    test("sends the fixed write action set without legacy source or credit fields", async () => {
      await createWith(["--github-access=write", "--yes", "--silent"]);
      expect(mockCreate).toHaveBeenCalledOnce();
      const params = mockCreate.mock.calls[0][0];
      expect(params.source).toEqual({
        type: "git",
        url: "https://github.com/vercel/api.git",
      });
      expect(params.credentials.github[0].repositories).toEqual(["vercel/api"]);
      expect(params.credentials.github[0].actions).toEqual([
        ...GITHUB_API_CREDENTIAL_ACTIONS,
        "git:write",
      ]);
      expect(params.credentials.github[0].actions).not.toContain(
        "git:write-workflows",
      );
      expect(params.commitAs).toBeUndefined();
      expect(mockInferCommitIdentity).not.toHaveBeenCalled();
    });
    test("rejects the unsupported read preset before creating anything", async () => {
      await expect(
        createWith(["--github-access=read", "--yes", "--silent"]),
      ).rejects.toThrow(/does not support/);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockInferRepository).not.toHaveBeenCalled();
    });
  });

  describe("opt-in defaults", () => {
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

    test("direct flags activate without a separate enable flag", async () => {
      await createWith([
        "--credentials-github-action=issues:read",
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
        "--credentials-github-action=labels:read",
        "--credentials-github-action=labels:write",
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].credentials.github[0].actions).toEqual(
        ["github:labels:read", "github:labels:write"],
      );
    });

    test("explicit API actions do not acquire Git write", async () => {
      await createWith([
        "--credentials-github-action=issues:read",
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].source).not.toHaveProperty(
        "credentials",
      );
      expect(mockCreate.mock.calls[0][0].commitAs).toBeUndefined();
      expect(mockCreate.mock.calls[0][0].credentials.github[0].actions).toEqual(
        ["github:issues:read"],
      );
    });

    test("an explicit commit identity overrides local Git configuration", async () => {
      await createWith([
        "--credentials-github-commit-as=Jack Jackson <myotheremail@scubbo.org>",
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
      await createWith([
        "--credentials-github-act-as=123456",
        "--yes",
        "--silent",
      ]);
      expect(mockInferActor).toHaveBeenCalledWith(
        expect.objectContaining({ explicit: "123456" }),
      );
      expect(mockCreate.mock.calls[0][0].credentials.github[0].actAs).toBe(
        "123456",
      );
    });

    test("an explicit repository overrides the local remote", async () => {
      await createWith([
        "--credentials-github-repo=acme/widgets",
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].source.url).toBe(
        "https://github.com/acme/widgets.git",
      );
      expect(mockInferRepository).not.toHaveBeenCalled();
    });
  });

  describe("legacy read-only Git option", () => {
    test("fails closed when the current creation API does not support git:read", async () => {
      await expect(
        createWith([
          "--enable-github-credentials",
          "--credentials-github-no-write",
          "--yes",
          "--silent",
        ]),
      ).rejects.toThrow(/does not support/);
      expect(mockCreate).not.toHaveBeenCalled();
    });
    test("does not merge a separate Git toggle into explicit actions", async () => {
      await expect(
        createWith([
          "--credentials-github-action=issues:comment",
          "--credentials-github-no-write",
          "--yes",
          "--silent",
        ]),
      ).rejects.toThrow(/complete action set/);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("identity resolution", () => {
    test("sends the resolved actor as the API identity", async () => {
      mockInferActor.mockResolvedValue({
        actAs: "@scubbo",
        login: "scubbo",
        source: "vercel-account-link",
      });
      await createWith(["--enable-github-credentials", "--yes", "--silent"]);
      expect(mockCreate.mock.calls[0][0].credentials.github[0].actAs).toBe(
        "@scubbo",
      );
    });

    test("creates nothing when actor resolution fails", async () => {
      mockInferActor.mockRejectedValue(
        new CliError("gh is logged in but `gh api user` failed."),
      );
      await expect(
        createWith(["--enable-github-credentials", "--yes", "--silent"]),
      ).rejects.toThrow(/gh api user/);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test("creates nothing when no actor can be resolved", async () => {
      mockInferActor.mockResolvedValue(undefined);
      await expect(
        createWith(["--enable-github-credentials", "--yes", "--silent"]),
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

    test("an empty github array acquires no default actions", async () => {
      const path = await writeConfig({ credentials: { github: [] } });
      await createWith([
        `--credentials-github-from-config-file=${path}`,
        "--yes",
        "--silent",
      ]);
      expect(mockCreate.mock.calls[0][0].credentials).toEqual({ github: [] });
      expect(mockCreate.mock.calls[0][0].commitAs).toBeUndefined();
    });

    test("does not consult local Git or gh for an explicit configuration", async () => {
      const path = await writeConfig({ credentials: { github: [] } });
      await createWith([
        `--credentials-github-from-config-file=${path}`,
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
          `--credentials-github-from-config-file=${path}`,
          "--credentials-github-action=issues:read",
          "--yes",
        ]),
      ).rejects.toThrow(/cannot be combined with/);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test("rejects a malformed file before authenticating or creating", async () => {
      const path = join(directory, "bad.json");
      await writeFile(path, "{ not json", "utf8");
      await expect(
        createWith([`--credentials-github-from-config-file=${path}`, "--yes"]),
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

    test("accepts a sandbox name", async () => {
      mockGet.mockResolvedValue({
        currentSession: () => ({
          sessionId: "sbx_source",
          status: "stopped",
          managedCredentials: { credentials: { github: [] } },
        }),
      });
      await createWith([
        "--credentials-github-from-sandbox=my-sandbox",
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
        createWith(["--credentials-github-from-sandbox=plain", "--yes"]),
      ).rejects.toThrow(/does not report a managed-credentials configuration/);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("persistence", () => {
    test("writes the default file name from the returned sbx_ identifier", async () => {
      const cwd = vi.spyOn(process, "cwd").mockReturnValue(directory);
      try {
        await createWith([
          "--enable-github-credentials",
          "--credentials-github-persist-configuration",
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
        source: { type: "git", url: "https://github.com/vercel/api.git" },
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
      });
    });

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

    test("round-trips: a persisted file replays to the same request", async () => {
      const path = join(directory, "round-trip.json");
      await createWith([
        "--enable-github-credentials",
        `--credentials-github-persist-configuration=${path}`,
        "--yes",
        "--silent",
      ]);
      const first = mockCreate.mock.calls[0][0];

      mockCreate.mockClear();
      await createWith([
        `--credentials-github-from-config-file=${path}`,
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

    test("rejects persisting when no configuration was requested", async () => {
      // Otherwise the command would succeed having written nothing.
      await expect(
        createWith([
          `--credentials-github-persist-configuration=${join(directory, "x.json")}`,
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
          "--enable-github-credentials",
          "--credentials-github-persist-configuration",
          join(directory, "out.json"),
          "--yes",
        ]),
      ).rejects.toThrow(/takes its path with an equals sign/);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test("still reports a repeated option by name", async () => {
      await expect(
        createWith([
          "--credentials-github-repo=acme/one",
          "--credentials-github-repo=acme/two",
          "--yes",
        ]),
      ).rejects.toThrow(/--credentials-github-repo/);
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

  describe("--dry-run", () => {
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

    test("--yes hides the proposal but keeps the dry-run outcome", async () => {
      await createWith(["--enable-github-credentials", "--dry-run", "--yes"]);
      expect(errText()).toContain("Dry run");
      expect(errText()).not.toContain("Managed credentials for this sandbox");
      expect(errText()).not.toContain("vercel/api");
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockHasProjectBounds).not.toHaveBeenCalled();
    });

    test("shows the proposal without requiring approval", async () => {
      await createWith(["--enable-github-credentials", "--dry-run"]);
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
        createWith(["--enable-github-credentials", "--silent"]),
      ).rejects.toMatchObject({ options: { reason: "confirmation_required" } });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test("shows the proposal before refusing", async () => {
      await createWith(["--enable-github-credentials", "--silent"]).catch(
        () => undefined,
      );
      expect(errText()).toContain("Managed credentials for this sandbox");
      expect(errText()).toContain("Commit credit");
      expect(errText()).toContain("GitHub actor");
    });

    test("--json does not prompt and does not grant consent", async () => {
      await expect(
        createWith(["--enable-github-credentials", "--json"]),
      ).rejects.toMatchObject({ options: { reason: "confirmation_required" } });
      expect(stdout).not.toHaveBeenCalled();
    });

    test("--yes suppresses the proposal even with --silent", async () => {
      await createWith(["--enable-github-credentials", "--silent", "--yes"]);
      expect(errText()).toBe("");
      expect(mockCreate).toHaveBeenCalledOnce();
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

    test("distinguishes a grant-policy denial from a request-schema rejection", async () => {
      mockCreate.mockRejectedValue(
        new APIError(new Response(null, { status: 403 }), {
          json: {
            error: {
              code: "git_credential_grant_forbidden",
              message: "private-policy-response-canary",
            },
          },
        }),
      );
      const error = await createWith([
        "--credentials-github-action=git:write",
        "--yes",
        "--json",
      ]).catch((error) => error);
      expect(error.message).toContain(
        "HTTP 403, git_credential_grant_forbidden",
      );
      expect(error.message).toContain("Bounds");
      expect(JSON.stringify(error.options)).not.toContain(
        "private-policy-response-canary",
      );
      expect(error.options.data.apiCode).toBe("git_credential_grant_forbidden");
      expect(mockCreate).toHaveBeenCalledOnce();
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

    test("does not restore an old Git source when the approved configuration has none", async () => {
      const preparation = await import(
        "../../src/util/managed-credentials-create"
      );
      vi.spyOn(preparation, "prepareManagedCredentials").mockResolvedValue({
        transport: { credentials: { github: [] } },
        config: { credentials: { github: [] } },
        vcpus: 6,
      });
      await createWith(["--enable-github-credentials", "--yes", "--silent"]);
      expect(mockCreate.mock.calls[0][0].source).toBeUndefined();
    });
    test("sh --rm rejects managed creation when stdin cannot support an interactive shell", async () => {
      const path = join(directory, "shell-credentials.json");
      await writeFile(path, JSON.stringify({ credentials: { github: [] } }));
      const { sh } = await import("../../src/commands/sh");
      await expect(
        cmd.run(sh, [
          "--scope=team",
          "--project=project",
          "--rm",
          "--yes",
          `--credentials-github-from-config-file=${path}`,
        ]),
      ).rejects.toThrow("interactive");
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockExec).not.toHaveBeenCalled();
    });
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
