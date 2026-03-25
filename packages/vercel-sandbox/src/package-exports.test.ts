import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

it("defines import/require export targets", () => {
  const packageJsonPath = resolve(__dirname, "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  expect(packageJson.exports?.["."]?.import).toBe("./dist/index.js");
  expect(packageJson.exports?.["."]?.require).toBe("./dist/index.cjs");
  expect(packageJson.exports?.["."]?.types).toBe("./dist/index.d.ts");
  expect(packageJson.exports?.["./dist/auth/index.js"]?.import).toBe(
    "./dist/auth/index.js",
  );
  expect(packageJson.exports?.["./dist/auth/index.js"]?.require).toBe(
    "./dist/auth/index.cjs",
  );
  expect(packageJson.exports?.["./dist/auth/index.js"]?.types).toBe(
    "./dist/auth/index.d.ts",
  );
  expect(packageJson.exports?.["./mock"]?.import).toBe("./dist/mock/index.js");
  expect(packageJson.exports?.["./mock"]?.require).toBe("./dist/mock/index.cjs");
  expect(packageJson.exports?.["./mock"]?.types).toBe("./dist/mock/index.d.ts");
});

it("resolves import and require to different entrypoints", () => {
  const packageRoot = resolve(__dirname, "..");

  const cjsResolution = execFileSync(
    process.execPath,
    ["-e", "console.log(require.resolve('@vercel/sandbox'))"],
    { cwd: packageRoot, encoding: "utf8" },
  ).trim();

  const esmResolutionUrl = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "console.log(await import.meta.resolve('@vercel/sandbox'))",
    ],
    { cwd: packageRoot, encoding: "utf8" },
  ).trim();

  const esmResolution = fileURLToPath(esmResolutionUrl);

  expect(cjsResolution).toBe(resolve(packageRoot, "dist/index.cjs"));
  expect(esmResolution).toBe(resolve(packageRoot, "dist/index.js"));
});

it("resolves auth subpath with format-appropriate files", () => {
  const packageRoot = resolve(__dirname, "..");

  const cjsResolution = execFileSync(
    process.execPath,
    [
      "-e",
      "console.log(require.resolve('@vercel/sandbox/dist/auth/index.js'))",
    ],
    { cwd: packageRoot, encoding: "utf8" },
  ).trim();

  const esmResolutionUrl = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "console.log(await import.meta.resolve('@vercel/sandbox/dist/auth/index.js'))",
    ],
    { cwd: packageRoot, encoding: "utf8" },
  ).trim();

  const esmResolution = fileURLToPath(esmResolutionUrl);

  expect(cjsResolution).toBe(resolve(packageRoot, "dist/auth/index.cjs"));
  expect(esmResolution).toBe(resolve(packageRoot, "dist/auth/index.js"));
});

it("resolves mock subpath with format-appropriate files", () => {
  const packageRoot = resolve(__dirname, "..");

  const cjsResolution = execFileSync(
    process.execPath,
    ["-e", "console.log(require.resolve('@vercel/sandbox/mock'))"],
    { cwd: packageRoot, encoding: "utf8" },
  ).trim();

  const esmResolutionUrl = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "console.log(await import.meta.resolve('@vercel/sandbox/mock'))",
    ],
    { cwd: packageRoot, encoding: "utf8" },
  ).trim();

  const esmResolution = fileURLToPath(esmResolutionUrl);

  expect(cjsResolution).toBe(resolve(packageRoot, "dist/mock/index.cjs"));
  expect(esmResolution).toBe(resolve(packageRoot, "dist/mock/index.js"));
});
