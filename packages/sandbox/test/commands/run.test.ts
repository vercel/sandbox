import { beforeEach, describe, expect, test, vi } from "vitest";
import * as cmd from "cmd-ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const { mockCreate, mockGet, mockExec } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGet: vi.fn(),
  mockExec: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  sandboxClient: {
    create: mockCreate,
    fork: vi.fn(),
    get: mockGet,
    list: vi.fn(),
  },
  snapshotClient: { get: vi.fn(), list: vi.fn(), tree: vi.fn() },
}));

vi.mock("../../src/commands/exec", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/commands/exec.ts")>();
  return { ...original, exec: { ...original.exec, handler: mockExec } };
});

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: vi.fn(),
  getVercelToken: vi.fn(),
}));

vi.mock("../../src/commands/login", () => ({
  login: { handler: vi.fn() },
}));

const scope = ["--scope=team", "--project=proj"];

describe("run command with a named sandbox that already exists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ name: "agent" });
    process.env.VERCEL_AUTH_TOKEN = "tok";
  });

  const REFUSAL = [
    "Sandbox agent already exists, so the GitHub credentials options cannot be applied to it.",
    "hint: A sandbox gets its GitHub access when it is created. Remove the GitHub credentials options to run in the existing sandbox as it is, or choose a new --name.",
  ].join("\n");

  async function refusal(options: string[]): Promise<string> {
    const { run } = await import("../../src/commands/run.ts");
    const error = await cmd
      .run(run, ["--name=agent", ...options, ...scope, "echo", "hi"])
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );
    return stripVTControlCharacters(
      String((error as Error | undefined)?.message),
    );
  }

  test.each([
    [
      "--credentials-github-repository",
      ["--credentials-github-repository=acme/web"],
    ],
    [
      "--credentials-github-actions",
      [
        "--credentials-github-repository=acme/web",
        "--credentials-github-actions=git:read",
      ],
    ],
    [
      "--credentials-github-act-as",
      [
        "--credentials-github-repository=acme/web",
        "--credentials-github-act-as=octocat",
      ],
    ],
  ])("refuses %s without running anything", async (_option, options) => {
    expect(await refusal(options)).toBe(REFUSAL);
    // The lookup must not resume the sandbox either.
    expect(mockGet).toHaveBeenCalledWith(
      expect.objectContaining({ name: "agent", resume: false }),
    );
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("refuses a credentials file that has a github entry", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "run-")), "credentials.json");
    writeFileSync(
      path,
      JSON.stringify({
        github: [{ repositories: ["acme/web"], actions: ["git:read"] }],
      }),
    );

    expect(await refusal([`--credentials-file=${path}`])).toBe(REFUSAL);
    expect(mockExec).not.toHaveBeenCalled();
  });

  test("still runs in the existing sandbox when only npm credentials are named", async () => {
    const { run } = await import("../../src/commands/run.ts");
    await cmd.run(run, [
      "--name=agent",
      "--credentials=npm",
      ...scope,
      "echo",
      "hi",
    ]);

    expect(mockGet).toHaveBeenCalledWith(
      expect.objectContaining({ name: "agent", resume: true }),
    );
    expect(mockExec).toHaveBeenCalledOnce();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
