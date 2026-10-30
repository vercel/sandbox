import { beforeEach, describe, expect, test, vi } from "vitest";
import { runCommand } from "../../src/util/managed-credentials-command";
import { readGhAccount } from "../../src/util/managed-credentials-gh";
vi.mock("../../src/util/managed-credentials-command", () => ({
  runCommand: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
describe("gh account metadata", () => {
  test("reads github.com identity without retrieving credentials", async () => {
    vi.mocked(runCommand)
      .mockResolvedValueOnce({ status: "ok", stdout: "logged in" })
      .mockResolvedValueOnce({
        status: "ok",
        stdout: JSON.stringify({
          login: "ada",
          id: 42,
          name: "Ada",
          email: null,
          token: "never-copy",
        }),
      });
    expect(await readGhAccount()).toEqual({
      login: "ada",
      id: 42,
      name: "Ada",
    });
    expect(vi.mocked(runCommand).mock.calls.map((call) => call[1])).toEqual([
      ["auth", "status", "--hostname", "github.com"],
      [
        "api",
        "user",
        "--hostname",
        "github.com",
        "--jq",
        "{login: .login, id: .id, name: .name, email: .email}",
      ],
    ]);
  });
  test.each([
    { status: "absent" as const },
    { status: "failed" as const, stderr: "You are not logged in" },
  ])("returns no answer for %j", async (result) => {
    vi.mocked(runCommand).mockResolvedValueOnce(result);
    expect(await readGhAccount()).toBeUndefined();
  });
  test.each(["network timeout", "expired token", "lacks required scopes"])(
    "does not substitute an identity after %s",
    async (stderr) => {
      vi.mocked(runCommand).mockResolvedValueOnce({ status: "failed", stderr });
      await expect(readGhAccount()).rejects.toMatchObject({
        options: { reason: "identity_lookup_failed" },
      });
    },
  );
  test.each([
    "not json",
    JSON.stringify({ login: "ada", id: 9007199254740992 }),
    JSON.stringify({ name: "Ada" }),
  ])("rejects unexpected user metadata", async (stdout) => {
    vi.mocked(runCommand)
      .mockResolvedValueOnce({ status: "ok", stdout: "logged in" })
      .mockResolvedValueOnce({ status: "ok", stdout });
    await expect(readGhAccount()).rejects.toThrow();
  });
});
