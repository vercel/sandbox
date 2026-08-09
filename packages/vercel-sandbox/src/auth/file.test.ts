import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = process.argv;

describe("auth file", () => {
  afterEach(() => {
    process.argv = originalArgv;
    vi.resetModules();
  });

  it("imports without an executable argument", async () => {
    process.argv = [];

    await expect(import("./file.js")).resolves.toMatchObject({
      getAuth: expect.any(Function),
      updateAuthConfig: expect.any(Function),
    });
  });
});
