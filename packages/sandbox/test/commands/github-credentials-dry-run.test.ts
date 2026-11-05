import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import * as cmd from "cmd-ts";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create } from "../../src/commands/create";
import { getAuth } from "@vercel/sandbox/dist/auth/index.js";
import { getVercelToken, getVercelOidcToken } from "@vercel/oidc";

const { createSandbox, login, bounds } = vi.hoisted(() => ({
  createSandbox: vi.fn(),
  login: vi.fn(),
  bounds: vi.fn(),
}));
vi.mock("../../src/client", () => ({
  sandboxClient: { create: createSandbox },
}));
vi.mock("../../src/commands/login", () => ({ login: { handler: login } }));
vi.mock("../../src/util/current-team", () => ({
  readVercelCurrentTeam: () => undefined,
}));
vi.mock("../../src/util/project-configuration", () => ({
  readProjectConfiguration: () => undefined,
}));
vi.mock("../../src/util/managed-credentials-project-bounds", () => ({
  hasProjectBounds: bounds,
}));
vi.mock("@vercel/sandbox/dist/auth/index.js", async (original) => ({
  ...(await original<typeof import("@vercel/sandbox/dist/auth/index.js")>()),
  getAuth: vi.fn(),
}));
vi.mock("@vercel/oidc", () => ({
  getVercelToken: vi.fn(),
  getVercelOidcToken: vi.fn(),
}));
vi.mock("../../src/telemetry/agent", () => ({
  detectAgentName: async () => undefined,
}));
vi.mock("../../src/util/managed-credentials-repository", () => ({
  inferRepository: async () => "acme/widgets",
}));
vi.mock("../../src/util/managed-credentials-actor", () => ({
  inferActor: async () => ({ actAs: "42", login: "grace", source: "gh" }),
}));
vi.mock("../../src/util/managed-credentials-commit", async (original) => ({
  ...(await original<
    typeof import("../../src/util/managed-credentials-commit")
  >()),
  inferCommitIdentity: async () => ({
    name: "Grace Hopper",
    email: "grace@example.com",
  }),
}));

let stdout: MockInstance<typeof process.stdout.write>;
let stderr: MockInstance<typeof process.stderr.write>;
let projectStatus: number;
let directory: string;
const requests: { url: string; method: string }[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), "sandbox-login-dry-run-"));
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  vi.stubEnv("VERCEL_AUTH_TOKEN", "");
  vi.stubEnv("VERCEL_TOKEN", "");
  vi.stubEnv("VERCEL_OIDC_TOKEN", "");
  vi.mocked(getAuth).mockReturnValue({ token: "stored-login-token" });
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  requests.length = 0;
  projectStatus = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      const method = options?.method ?? "GET";
      requests.push({ url, method });
      if (method !== "GET") throw new Error("Dry-run attempted a write");
      expect(new Headers(options?.headers).get("authorization")).toBe(
        "Bearer stored-login-token",
      );
      const parsed = new URL(url);
      if (parsed.pathname === "/api/v2/user")
        return Response.json({
          user: { defaultTeamId: "team_default", username: "grace" },
        });
      if (
        parsed.pathname === "/api/v2/projects/vercel-sandbox-default-project"
      ) {
        expect(parsed.searchParams.get("teamId")).toBe("team_default");
        return projectStatus === 200
          ? Response.json({})
          : Response.json(
              {
                error: { code: "not_found", message: "Project lookup failed" },
              },
              { status: projectStatus },
            );
      }
      if (parsed.pathname === "/api/v2/teams/team_default")
        return Response.json({ slug: "default-team" });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

function noMutations() {
  expect(createSandbox).not.toHaveBeenCalled();
  expect(bounds).not.toHaveBeenCalled();
  expect(login).not.toHaveBeenCalled();
  expect(getVercelToken).not.toHaveBeenCalled();
  expect(getVercelOidcToken).not.toHaveBeenCalled();
  expect(requests.every((request) => request.method === "GET")).toBe(true);
}

test.each([false, true])(
  "saved login alone resolves a managed dry-run (JSON: %s)",
  async (json) => {
    await cmd.run(create, [
      "--enable-github-credentials",
      "--dry-run",
      ...(json ? ["--json"] : []),
    ]);
    expect(getAuth).toHaveBeenCalled();
    expect(requests).toHaveLength(3);
    if (json) {
      expect(JSON.parse(stdout.mock.calls.flat().join(""))).toMatchObject({
        outcome: "dry_run",
        managedCredentials: {
          source: { type: "git", url: "https://github.com/acme/widgets.git" },
          credentials: { github: [{ actAs: "42" }] },
        },
      });
    } else {
      expect(stderr.mock.calls.flat().join("")).toContain("default-team");
      expect(stderr.mock.calls.flat().join("")).toContain(
        "vercel-sandbox-default-project",
      );
      const review = stderr.mock.calls.flat().join("");
      expect(review).toMatch(/Team\s+default-team\s+inferred from/);
      expect(review).toMatch(
        /Project\s+vercel-sandbox-default-project\s+default Sandbox project/,
      );
      expect(review).toMatch(/GitHub actor\s+@grace\s+inferred from/);
      expect(review).not.toMatch(/GitHub actor\s+42(?:\s|$)/);
      expect(review).not.toMatch(/Configuration\s+command-line flags/);
      expect(stdout).not.toHaveBeenCalled();
    }
    noMutations();
    expect(await readdir(directory)).toEqual([]);
  },
);

test.each([401, 404])(
  "lookup failure %s never creates a default project",
  async (status) => {
    projectStatus = status;
    await expect(
      cmd.run(create, ["--enable-github-credentials", "--dry-run", "--json"]),
    ).rejects.toMatchObject({
      options: { reason: "missing_context", json: true },
    });
    expect(stdout).not.toHaveBeenCalled();
    expect(requests).toHaveLength(2);
    noMutations();
    expect(await readdir(directory)).toEqual([]);
  },
);
