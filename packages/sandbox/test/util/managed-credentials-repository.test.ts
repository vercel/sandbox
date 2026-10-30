import { describe, expect, test, vi } from "vitest";
import { readCommand } from "../../src/util/managed-credentials-command";
import {
  inferRepository,
  repositoryFromRemote,
} from "../../src/util/managed-credentials-repository";
vi.mock("../../src/util/managed-credentials-command", () => ({
  readCommand: vi.fn(),
  GIT_TIMEOUT_MS: 5000,
}));
describe("repository inference", () => {
  test.each([
    "https://github.com/o/r.git",
    "git@github.com:o/r.git",
    "ssh://git@github.com/o/r.git",
  ])("accepts %s", (remote) => {
    expect(repositoryFromRemote(remote)).toBe("o/r");
  });
  test.each([
    "git@gitlab.com:o/r.git",
    "https://github.enterprise.com/o/r.git",
    "/local/repo",
    "https://secret@github.com/o/r",
    "git@github.com:o/r?token=secret",
  ])("rejects %s", (remote) => {
    expect(repositoryFromRemote(remote)).toBeUndefined();
  });
  test("prefers origin and ignores push-only remotes", async () => {
    vi.mocked(readCommand)
      .mockResolvedValueOnce("true")
      .mockResolvedValueOnce(
        "upstream git@github.com:upstream/r.git (fetch)\norigin https://github.com/own/r.git (fetch)\nother git@github.com:other/r.git (push)",
      );
    expect(await inferRepository("/work")).toBe("own/r");
  });
  test("falls back to another supported fetch remote", async () => {
    vi.mocked(readCommand)
      .mockResolvedValueOnce("true")
      .mockResolvedValueOnce(
        "origin git@gitlab.com:o/r.git (fetch)\nupstream git@github.com:o/r.git (fetch)",
      );
    expect(await inferRepository()).toBe("o/r");
  });
  test("returns no repository outside Git", async () => {
    vi.mocked(readCommand).mockResolvedValueOnce(undefined);
    expect(await inferRepository()).toBeUndefined();
  });
});
