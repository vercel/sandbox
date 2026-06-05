import { it, expect, describe, vi, beforeEach } from "vitest";
import {
  Containers,
  Container,
  ContainerRuntimeNotInstalledError,
} from "./containers";

type MockResult = {
  exitCode: number;
  stdout: ReturnType<typeof vi.fn>;
  stderr: ReturnType<typeof vi.fn>;
  output: ReturnType<typeof vi.fn>;
};

function mockResult(
  stdout = "",
  exitCode = 0,
  stderr = "",
  output = stdout + stderr,
): MockResult {
  return {
    exitCode,
    stdout: vi.fn().mockResolvedValue(stdout),
    stderr: vi.fn().mockResolvedValue(stderr),
    output: vi.fn().mockResolvedValue(output),
  };
}

function makeMockSandbox() {
  return {
    runCommand: vi.fn(),
  };
}

/**
 * Make every command succeed: the `command -v docker` check passes (a runtime
 * is installed) and `docker info` passes (the daemon is already running).
 */
function runtimeInstalledAndRunning(
  sandbox: ReturnType<typeof makeMockSandbox>,
) {
  sandbox.runCommand.mockResolvedValue(mockResult());
}

/** Does this runCommand call check whether the runtime binary is installed? */
function isRuntimeCheck(params: { cmd: string; args?: string[] }) {
  return (
    params.cmd === "sh" &&
    Array.isArray(params.args) &&
    params.args[1]?.includes("command -v docker") === true
  );
}

/** Does this runCommand call install the runtime via the package manager? */
function isInstall(params: { cmd: string; args?: string[] }) {
  return params.cmd === "dnf" && params.args?.[0] === "install";
}

describe("Containers", () => {
  let sandbox: ReturnType<typeof makeMockSandbox>;
  let containers: Containers;

  beforeEach(() => {
    sandbox = makeMockSandbox();
    containers = new Containers(sandbox as any);
  });

  describe("install", () => {
    it("installs docker via dnf and starts the daemon when none is present", async () => {
      let installed = false;
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) => {
          if (isRuntimeCheck(params)) {
            return Promise.resolve(mockResult("", installed ? 0 : 1));
          }
          if (isInstall(params)) {
            installed = true;
            return Promise.resolve(mockResult());
          }
          return Promise.resolve(mockResult());
        },
      );

      await containers.install();

      const calls = sandbox.runCommand.mock.calls.map((c) => c[0]);
      const install = calls.find(isInstall);
      expect(install).toBeDefined();
      expect(install.sudo).toBe(true);
      expect(install.args).toEqual(["install", "-y", "docker"]);
      // daemon readiness was checked
      expect(
        calls.some((c) => c.cmd === "docker" && c.args?.[0] === "info"),
      ).toBe(true);
    });

    it("skips the install when a runtime is already present", async () => {
      runtimeInstalledAndRunning(sandbox);
      await containers.install();
      const calls = sandbox.runCommand.mock.calls.map((c) => c[0]);
      expect(calls.some(isInstall)).toBe(false);
      // still ensures the daemon is up
      expect(
        calls.some((c) => c.cmd === "docker" && c.args?.[0] === "info"),
      ).toBe(true);
    });

    it("reinstalls when force is set even if present", async () => {
      runtimeInstalledAndRunning(sandbox);
      await containers.install({ force: true });
      const calls = sandbox.runCommand.mock.calls.map((c) => c[0]);
      expect(calls.some(isInstall)).toBe(true);
    });

    it("throws when the install fails", async () => {
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) => {
          if (isRuntimeCheck(params)) return Promise.resolve(mockResult("", 1));
          if (isInstall(params))
            return Promise.resolve(
              mockResult("", 1, "No match for argument: docker"),
            );
          return Promise.resolve(mockResult());
        },
      );
      await expect(containers.install()).rejects.toThrow(/No match/);
    });

    it("dedupes concurrent installs", async () => {
      let installed = false;
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) => {
          if (isRuntimeCheck(params)) {
            return Promise.resolve(mockResult("", installed ? 0 : 1));
          }
          if (isInstall(params)) {
            installed = true;
            return Promise.resolve(mockResult());
          }
          return Promise.resolve(mockResult());
        },
      );

      await Promise.all([
        containers.install(),
        containers.install(),
        containers.install(),
      ]);

      const installCalls = sandbox.runCommand.mock.calls.filter((c) =>
        isInstall(c[0]),
      );
      expect(installCalls).toHaveLength(1);
    });

    it("is a cheap no-op when called again after installing", async () => {
      runtimeInstalledAndRunning(sandbox);
      await containers.install();
      await containers.install();
      // the runtime presence check runs only for the first (memoized) install
      const checks = sandbox.runCommand.mock.calls.filter((c) =>
        isRuntimeCheck(c[0]),
      );
      expect(checks).toHaveLength(1);
    });

    it("force reinstalls even after a prior install", async () => {
      runtimeInstalledAndRunning(sandbox);
      await containers.install(); // present -> no install
      await containers.install({ force: true }); // forces install

      const installCalls = sandbox.runCommand.mock.calls.filter((c) =>
        isInstall(c[0]),
      );
      expect(installCalls).toHaveLength(1);
    });
  });

  describe("daemon", () => {
    it("starts the daemon when not yet running, then waits until ready", async () => {
      let infoCalls = 0;
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[]; detached?: boolean }) => {
          if (isRuntimeCheck(params)) return Promise.resolve(mockResult()); // installed
          if (params.cmd === "docker" && params.args?.[0] === "info") {
            infoCalls += 1;
            return Promise.resolve(mockResult("", infoCalls < 2 ? 1 : 0));
          }
          return Promise.resolve(mockResult());
        },
      );

      await containers.install();

      const calls = sandbox.runCommand.mock.calls.map((c) => c[0]);
      expect(
        calls.some(
          (c) =>
            c.cmd === "sh" &&
            c.detached === true &&
            Array.isArray(c.args) &&
            c.args[1]?.includes("dockerd"),
        ),
      ).toBe(true);
      expect(infoCalls).toBeGreaterThanOrEqual(2);
    });

    it("skips the daemon entirely when `daemon` is null", async () => {
      containers = new Containers(sandbox as any, {
        runtime: "podman",
        daemon: null,
      });
      sandbox.runCommand.mockResolvedValue(mockResult());

      await containers.install();

      const calls = sandbox.runCommand.mock.calls.map((c) => c[0]);
      // never starts a daemon and never polls `info`
      expect(calls.some((c) => c.cmd === "podman" && c.args?.[0] === "info")).toBe(
        false,
      );
      expect(
        calls.some(
          (c) =>
            c.cmd === "sh" &&
            c.detached === true &&
            Array.isArray(c.args) &&
            c.args[1]?.includes(" > /tmp/"),
        ),
      ).toBe(false);
    });
  });

  describe("custom runtime", () => {
    it("uses an overridden `runtime` binary for container commands", async () => {
      containers = new Containers(sandbox as any, {
        runtime: "podman",
        daemon: null,
      });
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) =>
          params.args?.[0] === "run"
            ? Promise.resolve(mockResult("cid"))
            : Promise.resolve(mockResult()),
      );

      const container = await containers.start("redis:latest", {
        defaults: false,
      });
      const runCall = sandbox.runCommand.mock.calls
        .map((c) => c[0])
        .find((c) => c.args?.[0] === "run");
      expect(runCall.cmd).toBe("podman");

      // container operations also use the overridden runtime
      await container.exec("redis-cli", "PING");
      expect(sandbox.runCommand).toHaveBeenCalledWith({
        cmd: "podman",
        args: ["exec", "cid", "redis-cli", "PING"],
        sudo: true,
      });
    });
  });

  describe("runtime not installed", () => {
    it("start throws ContainerRuntimeNotInstalledError", async () => {
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) =>
          isRuntimeCheck(params)
            ? Promise.resolve(mockResult("", 1))
            : Promise.resolve(mockResult()),
      );
      await expect(containers.start("redis:latest")).rejects.toBeInstanceOf(
        ContainerRuntimeNotInstalledError,
      );
      // it never tries to install
      expect(sandbox.runCommand.mock.calls.map((c) => c[0]).some(isInstall)).toBe(
        false,
      );
    });
  });

  describe("start", () => {
    beforeEach(() => {
      runtimeInstalledAndRunning(sandbox);
    });

    it("runs `run -d` and returns a Container with the parsed id", async () => {
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) => {
          if (params.cmd === "docker" && params.args?.[0] === "run") {
            return Promise.resolve(mockResult("abc123\n"));
          }
          return Promise.resolve(mockResult());
        },
      );

      const container = await containers.start("redis:latest", {
        defaults: false,
      });
      expect(container).toBeInstanceOf(Container);
      expect(container.id).toBe("abc123");
      expect(container.image).toBe("redis:latest");

      const runCall = sandbox.runCommand.mock.calls
        .map((c) => c[0])
        .find((c) => c.cmd === "docker" && c.args?.[0] === "run");
      expect(runCall.sudo).toBe(true);
      expect(runCall.args).toEqual(["run", "-d", "redis:latest"]);
    });

    it("maps ports as host:container", async () => {
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) =>
          params.args?.[0] === "run"
            ? Promise.resolve(mockResult("id"))
            : Promise.resolve(mockResult()),
      );

      await containers.start("redis:latest", {
        ports: { 6379: 6379 },
        defaults: false,
      });
      const runCall = sandbox.runCommand.mock.calls
        .map((c) => c[0])
        .find((c) => c.args?.[0] === "run");
      expect(runCall.args).toEqual([
        "run",
        "-d",
        "-p",
        "6379:6379",
        "redis:latest",
      ]);
    });

    it("resolves relative volume paths against the cwd and pre-creates them", async () => {
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) => {
          if (params.cmd === "pwd") {
            return Promise.resolve(mockResult("/vercel/sandbox\n"));
          }
          if (params.args?.[0] === "run") {
            return Promise.resolve(mockResult("id"));
          }
          return Promise.resolve(mockResult());
        },
      );

      await containers.start("redis:latest", {
        volumes: { "./redis-data": "/data" },
        defaults: false,
      });

      const calls = sandbox.runCommand.mock.calls.map((c) => c[0]);
      // mkdir -p with the resolved absolute path
      expect(calls).toContainEqual(
        expect.objectContaining({
          cmd: "mkdir",
          args: ["-p", "/vercel/sandbox/redis-data"],
        }),
      );
      const runCall = calls.find((c) => c.args?.[0] === "run");
      expect(runCall.args).toEqual([
        "run",
        "-d",
        "-v",
        "/vercel/sandbox/redis-data:/data",
        "redis:latest",
      ]);
    });

    it("passes absolute volume paths through and treats bare names as named volumes", async () => {
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) =>
          params.args?.[0] === "run"
            ? Promise.resolve(mockResult("id"))
            : Promise.resolve(mockResult()),
      );

      await containers.start("redis:latest", {
        volumes: { "/abs/data": "/data", cache: "/cache" },
        defaults: false,
      });
      const runCall = sandbox.runCommand.mock.calls
        .map((c) => c[0])
        .find((c) => c.args?.[0] === "run");
      expect(runCall.args).toEqual([
        "run",
        "-d",
        "-v",
        "/abs/data:/data",
        "-v",
        "cache:/cache",
        "redis:latest",
      ]);
      // no pwd lookup needed when there are no relative paths
      expect(
        sandbox.runCommand.mock.calls.some((c) => c[0].cmd === "pwd"),
      ).toBe(false);
    });

    it("includes name, env, flags and command", async () => {
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) =>
          params.args?.[0] === "run"
            ? Promise.resolve(mockResult("id"))
            : Promise.resolve(mockResult()),
      );

      await containers.start("node:22", {
        name: "worker",
        env: { NODE_ENV: "production" },
        flags: ["--restart", "always"],
        cmd: ["node", "app.js"],
        defaults: false,
      });
      const runCall = sandbox.runCommand.mock.calls
        .map((c) => c[0])
        .find((c) => c.args?.[0] === "run");
      expect(runCall.args).toEqual([
        "run",
        "-d",
        "--name",
        "worker",
        "-e",
        "NODE_ENV=production",
        "--restart",
        "always",
        "node:22",
        "node",
        "app.js",
      ]);
    });

    it("sets the working directory with -w", async () => {
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) =>
          params.args?.[0] === "run"
            ? Promise.resolve(mockResult("id"))
            : Promise.resolve(mockResult()),
      );

      await containers.start("redis:latest", { cwd: "/app", defaults: false });
      const runCall = sandbox.runCommand.mock.calls
        .map((c) => c[0])
        .find((c) => c.args?.[0] === "run");
      expect(runCall.args).toEqual([
        "run",
        "-d",
        "-w",
        "/app",
        "redis:latest",
      ]);
    });

    it("throws when `run` fails", async () => {
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) =>
          params.args?.[0] === "run"
            ? Promise.resolve(mockResult("", 1, "no such image"))
            : Promise.resolve(mockResult()),
      );
      await expect(containers.start("nope:latest")).rejects.toThrow(
        /no such image/,
      );
    });

    describe("CA certificates", () => {
      const RHEL_ANCHOR = "/etc/pki/ca-trust/source/anchors/vercel-proxy-ca.pem";
      const DEBIAN_ANCHOR =
        "/usr/local/share/ca-certificates/vercel-proxy-ca.crt";
      const SYSTEM_BUNDLE = "/etc/ssl/certs/ca-certificates.crt";

      /** Mock so `run` returns a container id; everything else succeeds. */
      function runtimeReady() {
        sandbox.runCommand.mockImplementation(
          (params: { cmd: string; args?: string[] }) =>
            params.args?.[0] === "run"
              ? Promise.resolve(mockResult("cid"))
              : Promise.resolve(mockResult()),
        );
      }

      function runArgs() {
        return sandbox.runCommand.mock.calls
          .map((c) => c[0])
          .find((c) => c.args?.[0] === "run").args as string[];
      }

      it("bind-mounts both CA anchors and sets CA env by default", async () => {
        runtimeReady();
        await containers.start("redis:latest");
        const args = runArgs();
        expect(args).toEqual(
          expect.arrayContaining([
            "-v",
            `${RHEL_ANCHOR}:${RHEL_ANCHOR}:ro`,
            `${DEBIAN_ANCHOR}:${DEBIAN_ANCHOR}:ro`,
            "-e",
            `NODE_EXTRA_CA_CERTS=${SYSTEM_BUNDLE}`,
            `SSL_CERT_FILE=${SYSTEM_BUNDLE}`,
            `REQUESTS_CA_BUNDLE=${SYSTEM_BUNDLE}`,
            `NODE_USE_SYSTEM_CA=1`,
          ]),
        );
      });

      it("appends a CA anchor to the system bundle after start", async () => {
        runtimeReady();
        await containers.start("redis:latest");
        const calls = sandbox.runCommand.mock.calls.map((c) => c[0]);
        const update = calls.find(
          (c) => c.cmd === "docker" && c.args?.[0] === "exec",
        );
        expect(update.args.slice(0, 4)).toEqual(["exec", "cid", "sh", "-c"]);
        // appends exactly one existing anchor to the (possibly symlinked) bundle
        const script = update.args[4];
        expect(script).toContain(`>> ${SYSTEM_BUNDLE}`);
        expect(script).toContain(RHEL_ANCHOR);
        expect(script).toContain(DEBIAN_ANCHOR);
        expect(script).toContain("break");
        expect(update.sudo).toBe(true);
      });

      it("does not set up CA trust when defaults is false", async () => {
        runtimeReady();
        await containers.start("redis:latest", { defaults: false });
        const calls = sandbox.runCommand.mock.calls.map((c) => c[0]);
        // no update-ca exec
        expect(
          calls.some((c) => c.cmd === "docker" && c.args?.[0] === "exec"),
        ).toBe(false);
        const runCall = calls.find((c) => c.args?.[0] === "run");
        expect(runCall.args).toEqual(["run", "-d", "redis:latest"]);
      });

      it("lets caller env override the CA trust env", async () => {
        runtimeReady();
        await containers.start("redis:latest", {
          env: { SSL_CERT_FILE: "/custom" },
        });
        const args = runArgs();
        // the CA default is added first, the caller value last (last wins)
        const first = args.indexOf(`SSL_CERT_FILE=${SYSTEM_BUNDLE}`);
        const last = args.lastIndexOf("SSL_CERT_FILE=/custom");
        expect(first).toBeGreaterThanOrEqual(0);
        expect(last).toBeGreaterThan(first);
      });

      it("does not mount over a CA anchor path the caller already uses", async () => {
        runtimeReady();
        await containers.start("redis:latest", {
          volumes: { "/my/ca.pem": RHEL_ANCHOR },
        });
        const args = runArgs();
        // caller's mount is present
        expect(args).toEqual(
          expect.arrayContaining(["-v", `/my/ca.pem:${RHEL_ANCHOR}`]),
        );
        // the auto anchor mount onto the same target is skipped
        expect(args).not.toContain(`${RHEL_ANCHOR}:${RHEL_ANCHOR}:ro`);
        // the other anchor is still mounted
        expect(args).toContain(`${DEBIAN_ANCHOR}:${DEBIAN_ANCHOR}:ro`);
      });
    });
  });

  describe("list", () => {
    beforeEach(() => {
      runtimeInstalledAndRunning(sandbox);
    });

    it("parses tab-separated ps output", async () => {
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) => {
          if (params.args?.[0] === "ps") {
            return Promise.resolve(
              mockResult("abc\tredis:latest\tmyredis\tUp 2 minutes\n"),
            );
          }
          return Promise.resolve(mockResult());
        },
      );

      const list = await containers.list();
      expect(list).toEqual([
        {
          id: "abc",
          image: "redis:latest",
          name: "myredis",
          status: "Up 2 minutes",
        },
      ]);
    });

    it("returns an empty array when there are no containers", async () => {
      sandbox.runCommand.mockImplementation(
        (params: { cmd: string; args?: string[] }) =>
          params.args?.[0] === "ps"
            ? Promise.resolve(mockResult("\n"))
            : Promise.resolve(mockResult()),
      );
      expect(await containers.list()).toEqual([]);
    });
  });

  describe("get", () => {
    it("returns a Container handle without making any calls", () => {
      const container = containers.get("abc", "redis:latest");
      expect(container).toBeInstanceOf(Container);
      expect(container.id).toBe("abc");
      expect(container.image).toBe("redis:latest");
      expect(sandbox.runCommand).not.toHaveBeenCalled();
    });
  });
});

describe("Container", () => {
  let sandbox: ReturnType<typeof makeMockSandbox>;
  let container: Container;

  beforeEach(() => {
    sandbox = makeMockSandbox();
    container = new Container({
      sandbox: sandbox as any,
      id: "abc123",
      image: "redis:latest",
    });
  });

  describe("exec", () => {
    it("runs `docker exec` with the command and args", async () => {
      const result = mockResult("PONG");
      sandbox.runCommand.mockResolvedValue(result);

      const out = await container.exec("redis-cli", "PING");
      expect(out).toBe(result);
      expect(sandbox.runCommand).toHaveBeenCalledWith({
        cmd: "docker",
        args: ["exec", "abc123", "redis-cli", "PING"],
        sudo: true,
      });
    });
  });

  describe("stop", () => {
    it("runs `docker stop`", async () => {
      sandbox.runCommand.mockResolvedValue(mockResult());
      await container.stop();
      expect(sandbox.runCommand).toHaveBeenCalledWith({
        cmd: "docker",
        args: ["stop", "abc123"],
        sudo: true,
        signal: undefined,
      });
    });

    it("passes a timeout", async () => {
      sandbox.runCommand.mockResolvedValue(mockResult());
      await container.stop({ timeout: 5 });
      expect(sandbox.runCommand).toHaveBeenCalledWith({
        cmd: "docker",
        args: ["stop", "--time", "5", "abc123"],
        sudo: true,
        signal: undefined,
      });
    });

    it("throws on failure", async () => {
      sandbox.runCommand.mockResolvedValue(
        mockResult("", 1, "no such container"),
      );
      await expect(container.stop()).rejects.toThrow(/no such container/);
    });
  });

  describe("start", () => {
    it("runs `docker start`", async () => {
      sandbox.runCommand.mockResolvedValue(mockResult());
      await container.start();
      expect(sandbox.runCommand).toHaveBeenCalledWith({
        cmd: "docker",
        args: ["start", "abc123"],
        sudo: true,
        signal: undefined,
      });
    });
  });

  describe("remove", () => {
    it("runs `docker rm` and supports force", async () => {
      sandbox.runCommand.mockResolvedValue(mockResult());
      await container.remove({ force: true });
      expect(sandbox.runCommand).toHaveBeenCalledWith({
        cmd: "docker",
        args: ["rm", "-f", "abc123"],
        sudo: true,
        signal: undefined,
      });
    });
  });

  describe("logs", () => {
    it("returns combined output", async () => {
      sandbox.runCommand.mockResolvedValue(
        mockResult("log line", 0, "", "log line"),
      );
      const logs = await container.logs();
      expect(logs).toBe("log line");
      expect(sandbox.runCommand).toHaveBeenCalledWith({
        cmd: "docker",
        args: ["logs", "abc123"],
        sudo: true,
        signal: undefined,
      });
    });

    it("supports tail and timestamps", async () => {
      sandbox.runCommand.mockResolvedValue(mockResult("x", 0, "", "x"));
      await container.logs({ tail: 10, timestamps: true });
      expect(sandbox.runCommand).toHaveBeenCalledWith({
        cmd: "docker",
        args: ["logs", "--tail", "10", "--timestamps", "abc123"],
        sudo: true,
        signal: undefined,
      });
    });
  });
});
