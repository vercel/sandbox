import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
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

  test("credential help stays offline and is hidden without the gate", () => {
    for (const enabled of ["", "1"]) {
      const result = spawnSync(
        process.execPath,
        [path.join(outRoot, "bin/sandbox.mjs"), "create", "--help"],
        {
          cwd: outRoot,
          env: {
            ...env,
            __VERCEL_SANDBOX_MANAGED_CREDENTIALS: enabled,
            VERCEL_TOKEN: "",
            VERCEL_AUTH_TOKEN: "",
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.includes("--github-action")).toBe(enabled === "1");
      expect(result.stdout.includes("--managed-credentials-file")).toBe(
        enabled === "1",
      );
    }
  });

  test("the binary forwards repeated options all the way to the API", () => {
    const { preload, request } = mockApi("repeated");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        path.join(outRoot, "bin/sandbox.mjs"),
        "create",
        "--scope=acme",
        "--project=acme-web",
        "--git-source=https://github.com/acme/widgets.git",
        "--commit-as-name=Grace Hopper",
        "--commit-as-email=grace@example.com",
        "--github-repository=acme/widgets",
        "--github-action=github:issues:read",
        "--github-action=github:pull-request:create",
        "--github-act-as=42",
        "--yes",
        "--json",
      ],
      {
        cwd: outRoot,
        env: credentialEnv(),
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      outcome: "created",
      sandbox: { name: "mock-sandbox" },
    });
    expect(JSON.parse(readFileSync(request, "utf8"))).toMatchObject({
      source: { type: "git", url: "https://github.com/acme/widgets.git" },
      commitAs: { name: "Grace Hopper", email: "grace@example.com" },
      credentials: {
        github: [
          {
            repositories: ["acme/widgets"],
            actions: ["github:issues:read", "github:pull-request:create"],
            actAs: "42",
          },
        ],
      },
    });
  });

  test("--commit-as-me reads the global Git identity in the built binary", () => {
    const { preload, request } = mockApi("commit-as-me");
    const config = path.join(outRoot, "global-gitconfig");
    writeFileSync(
      config,
      "[user]\n name = Grace Hopper\n email = grace@example.com\n",
    );
    const args = [
      "create",
      "--scope=acme",
      "--project=acme-web",
      "--git-source=https://github.com/acme/widgets.git",
      "--commit-as-me",
      "--yes",
      "--json",
    ];
    const result = spawnSync(
      process.execPath,
      ["--import", preload, path.join(outRoot, "bin/sandbox.mjs"), ...args],
      {
        cwd: outRoot,
        env: { ...credentialEnv(), GIT_CONFIG_GLOBAL: config },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).outcome).toBe("created");
    expect(JSON.parse(readFileSync(request, "utf8"))).toMatchObject({
      source: { type: "git", url: "https://github.com/acme/widgets.git" },
      commitAs: { name: "Grace Hopper", email: "grace@example.com" },
    });
  });

  test.each(["--commit-as-name=Grace", "--commit-as-email=grace@example.com"])(
    "--commit-as-me rejects %s before an API request",
    (option) => {
      const { preload, request } = mockApi(
        `commit-as-me-conflict-${option.startsWith("--commit-as-name") ? "name" : "email"}`,
      );
      const args = [
        "create",
        "--scope=acme",
        "--project=acme-web",
        "--git-source=https://github.com/acme/widgets.git",
        "--commit-as-me",
        option,
        "--yes",
        "--json",
      ];
      const result = spawnSync(
        process.execPath,
        ["--import", preload, path.join(outRoot, "bin/sandbox.mjs"), ...args],
        {
          cwd: outRoot,
          env: credentialEnv(),
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr).message).toContain(
        "--commit-as-me cannot be combined",
      );
      expect(existsSync(request)).toBe(false);
    },
  );

  test("stdin carries independent groups without contaminating JSON stdout", () => {
    const { preload, request } = mockApi("stdin");
    const credentials = {
      github: [
        {
          repositories: ["acme/widgets"],
          actions: ["github:issues:read"],
          actAs: "42",
        },
        {
          repositories: ["acme/reference"],
          actions: ["github:pull-request:create"],
          actAs: "alice",
        },
      ],
    };
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        path.join(outRoot, "bin/sandbox.mjs"),
        "create",
        "--scope=acme",
        "--project=acme-web",
        "--managed-credentials-file=-",
        "--yes",
        "--json",
      ],
      {
        cwd: outRoot,
        env: credentialEnv(),
        input: JSON.stringify({ credentials }),
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).outcome).toBe("created");
    expect(result.stdout).not.toContain("credentials");
    expect(JSON.parse(readFileSync(request, "utf8")).credentials).toEqual({
      github: [
        credentials.github[0],
        { ...credentials.github[1], actAs: "@alice" },
      ],
    });
  });

  test("the built binary sends a username to the API without a GitHub lookup", () => {
    const { preload, request } = mockApi("username");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        path.join(outRoot, "bin/sandbox.mjs"),
        "create",
        "--scope=acme",
        "--project=acme-web",
        "--github-repository=acme/widgets",
        "--github-action=github:issues:read",
        "--github-act-as=alice",
        "--yes",
        "--json",
      ],
      { cwd: outRoot, env: credentialEnv(), encoding: "utf8", timeout: 10_000 },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(
      JSON.parse(readFileSync(request, "utf8")).credentials.github[0].actAs,
    ).toBe("@alice");
  });

  test("the old --file option is not accepted", () => {
    const { preload, request } = mockApi("old-file");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        path.join(outRoot, "bin/sandbox.mjs"),
        "create",
        "--scope=acme",
        "--project=acme-web",
        "--file=example.json",
        "--yes",
      ],
      { cwd: outRoot, env: credentialEnv(), encoding: "utf8", timeout: 10_000 },
    );
    expect(result.status).not.toBe(0);
    expect(existsSync(request)).toBe(false);
  });

  test("JSON without consent exits 2, writes only stderr and makes no request", () => {
    const { preload, request } = mockApi("no-consent");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        path.join(outRoot, "bin/sandbox.mjs"),
        "create",
        "--scope=acme",
        "--project=acme-web",
        "--github",
        "--json",
      ],
      {
        cwd: outRoot,
        env: credentialEnv(),
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).reason).toBe("confirmation_required");
    expect(existsSync(request)).toBe(false);
  });

  test("the embedded CLI preserves its prefix and exit code", () => {
    const { preload } = mockApi("embedded");
    const host = path.join(outRoot, "credential-host.mjs");
    writeFileSync(
      host,
      `import { createApp } from "./dist/index.mjs"; await createApp({appName:"vercel sandbox",withoutAuth:false}).run(process.argv.slice(2));`,
    );
    const args = [
      "create",
      "--scope=acme",
      "--project=acme-web",
      "--github",
      "--json",
    ];
    const denied = spawnSync(
      process.execPath,
      ["--import", preload, host, ...args],
      { cwd: outRoot, env: credentialEnv(), encoding: "utf8", timeout: 10_000 },
    );
    expect(denied.status).toBe(2);
    expect(denied.stdout).toBe("");
    expect(JSON.parse(denied.stderr).reason).toBe("confirmation_required");
    const allowed = spawnSync(
      process.execPath,
      ["--import", preload, host, ...args, "--yes"],
      { cwd: outRoot, env: credentialEnv(), encoding: "utf8", timeout: 10_000 },
    );
    expect(allowed.status).toBe(0);
    expect(allowed.stderr).toBe("");
    expect(JSON.parse(allowed.stdout).next[0].argv.slice(0, 2)).toEqual([
      "vercel",
      "sandbox",
    ]);
  });
});

function credentialEnv() {
  return {
    ...env,
    __VERCEL_SANDBOX_MANAGED_CREDENTIALS: "1",
    VERCEL_TOKEN: "test-token",
    VERCEL_AUTH_TOKEN: "test-token",
  };
}

function mockApi(name: string) {
  const preload = path.join(outRoot, `${name}-api.mjs`);
  const request = path.join(outRoot, `${name}-request.json`);
  writeFileSync(
    preload,
    `
    import { writeFileSync } from "node:fs";
    globalThis.fetch = async (url, init) => {
      if (!String(url).includes("/sandboxes") || init?.method !== "POST") throw new Error("Unexpected network request in offline test");
      writeFileSync(${JSON.stringify(request)}, init.body);
      return new Response(JSON.stringify({
        sandbox: {name:"mock-sandbox",persistent:true,currentSessionId:"sbx_test",status:"running",createdAt:1,updatedAt:1},
        session: {id:"sbx_test",memory:2048,vcpus:1,region:"iad1",timeout:300000,status:"running",requestedAt:1,createdAt:1,updatedAt:1,cwd:"/",interactivePort:8443},
        routes:[]
      }), {status:200,headers:{"content-type":"application/json"}});
    };
  `,
  );
  return { preload, request };
}
