import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The published package is a tsdown bundle, and code splitting decides which
// module ends up in which chunk. These tests build that bundle and run it the
// way users do: as the `sandbox` binary, and through `createApp()` inside a
// host CLI such as `vercel sandbox`, whose process.argv belongs to the host.

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const tsdownBin = path.join(
  path.dirname(require.resolve("tsdown/package.json")),
  "dist/run.mjs",
);
const env = {
  ...process.env,
  NO_COLOR: "1",
  VERCEL_SANDBOX_TELEMETRY_DISABLED: "1",
};

let outRoot: string;

beforeAll(() => {
  // Inside the package so the bundle resolves its dependencies from
  // packages/sandbox/node_modules.
  const cacheDir = path.join(packageRoot, "node_modules", ".cache");
  mkdirSync(cacheDir, { recursive: true });
  outRoot = mkdtempSync(path.join(cacheDir, "bundle-test-"));
  execFileSync(
    process.execPath,
    [tsdownBin, "--out-dir", path.join(outRoot, "dist"), "--no-dts"],
    { cwd: packageRoot, env, stdio: "pipe" },
  );
  mkdirSync(path.join(outRoot, "bin"));
  cpSync(
    path.join(packageRoot, "bin/sandbox.mjs"),
    path.join(outRoot, "bin/sandbox.mjs"),
  );
}, 120_000);

afterAll(() => {
  if (outRoot) rmSync(outRoot, { recursive: true, force: true });
});

function run(args: string[]) {
  const result = spawnSync(process.execPath, args, {
    cwd: outRoot,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe("built package", () => {
  test("createApp() parses only the arguments passed to run()", () => {
    const host = path.join(outRoot, "host.mjs");
    writeFileSync(
      host,
      [
        `process.argv = [process.argv[0], "/usr/local/bin/vercel", "sandbox", "config", "network-policy", "--help"];`,
        `const { createApp } = await import("./dist/index.mjs");`,
        `await createApp({ appName: "vercel sandbox", withoutAuth: false }).run(["config", "network-policy", "--help"]);`,
      ].join("\n"),
    );

    const { status, output } = run([host]);

    expect(output).not.toContain("Not a valid subcommand name");
    expect(output).toContain("vercel sandbox config network-policy");
    expect(output).toContain("--request-header");
    expect(status).toBe(0);
  });

  test("the sandbox binary still runs", () => {
    const { status, output } = run([
      path.join(outRoot, "bin/sandbox.mjs"),
      "config",
      "network-policy",
      "--help",
    ]);

    expect(output).toContain("sandbox config network-policy");
    expect(output).toContain("--request-header");
    expect(status).toBe(0);
  });
});
