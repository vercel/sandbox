import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);

function versionOf(packageJsonPath: string): string {
  return (JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string }).version;
}

// The mock and the real SDK are a fixed changesets group, so every release
// bumps them to the same version. This guards against manual drift: the mock
// version must always equal @vercel/sandbox so customers install a mock whose
// feature set matches the SDK they run against.
describe("version parity with @vercel/sandbox", () => {
  test("the mock is versioned identically to the real SDK", () => {
    const mockVersion = versionOf(fileURLToPath(new URL("../package.json", import.meta.url)));
    const realVersion = versionOf(require.resolve("@vercel/sandbox/package.json"));
    expect(mockVersion).toBe(realVersion);
  });
});
