import { posix } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { Command, CommandFinished } from "./command.js";
import type { RunCommandParams } from "./session.js";

/**
 * Thrown when no container runtime is installed in the sandbox. Call
 * {@link Containers.install} to install one, or create the sandbox from an
 * image that already includes it.
 */
export class ContainerRuntimeNotInstalledError extends Error {
  constructor() {
    super(
      "No container runtime found in this sandbox. Call `await sandbox.containers.install()` to install Docker, or create the sandbox from an image that includes it.",
    );
    this.name = "ContainerRuntimeNotInstalledError";
  }
}

/**
 * Default Docker-compatible CLI used to manage containers
 * ({@link Containers.runtime}).
 * @internal
 */
const DEFAULT_RUNTIME_CMD = "docker";

/**
 * Default container runtime daemon the CLI talks to
 * ({@link Containers.daemon}).
 * @internal
 */
const DEFAULT_DAEMON_CMD = "dockerd";

/** How long to wait for the container runtime to become ready, in milliseconds. */
const RUNTIME_READY_TIMEOUT_MS = 30_000;
/** Interval between runtime readiness checks, in milliseconds. */
const RUNTIME_POLL_INTERVAL_MS = 500;

/**
 * Distribution-specific trust-source anchor paths for the Vercel network proxy
 * CA. The sandbox always has the CA present at these locations, and we
 * bind-mount them (read-only) into containers at the same paths so an
 * in-container `update-ca-trust`/`update-ca-certificates` integrates them.
 * @internal
 */
const CA_ANCHOR_PATHS = [
  // RHEL/Fedora/Amazon Linux (update-ca-trust reads this anchors dir)
  "/etc/pki/ca-trust/source/anchors/vercel-proxy-ca.pem",
  // Debian/Ubuntu/Alpine (update-ca-certificates only ingests *.crt here)
  "/usr/local/share/ca-certificates/vercel-proxy-ca.crt",
];

/** The well-known system CA bundle most tools and runtimes read. */
const SYSTEM_CA_BUNDLE = "/etc/ssl/certs/ca-certificates.crt";

/**
 * Environment variables that point well-known tools and language runtimes at
 * the system CA bundle so they trust the proxy CA.
 * @internal
 */
const CA_TRUST_ENV: Record<string, string> = {
  AWS_CA_BUNDLE: SYSTEM_CA_BUNDLE,
  CARGO_HTTP_CAINFO: SYSTEM_CA_BUNDLE,
  CURL_CA_BUNDLE: SYSTEM_CA_BUNDLE,
  GIT_SSL_CAINFO: SYSTEM_CA_BUNDLE,
  GRPC_DEFAULT_SSL_ROOTS_FILE_PATH: SYSTEM_CA_BUNDLE,
  NODE_EXTRA_CA_CERTS: SYSTEM_CA_BUNDLE,
  NODE_USE_SYSTEM_CA: "1",
  NPM_CONFIG_CAFILE: SYSTEM_CA_BUNDLE,
  PIP_CERT: SYSTEM_CA_BUNDLE,
  REQUESTS_CA_BUNDLE: SYSTEM_CA_BUNDLE,
  SSL_CERT_FILE: SYSTEM_CA_BUNDLE,
};

/**
 * Command run inside the container to integrate the proxy CA into the system
 * bundle. It appends the first mounted anchor that exists to the (possibly
 * symlinked) bundle so the CA is trusted immediately, without depending on the
 * image's `update-ca-*` tooling. The `>>` redirect follows the symlink and
 * appends to its target, and only one anchor is used to avoid duplicating the
 * certificate.
 * @internal
 */
const APPEND_CA_COMMAND = `for f in ${CA_ANCHOR_PATHS.join(
  " ",
)}; do if [ -f "$f" ]; then cat "$f" >> ${SYSTEM_CA_BUNDLE}; break; fi; done`;

/**
 * The minimal surface of {@link Sandbox} that the container API depends on.
 * Modeled as an interface so it can be mocked in tests.
 * @internal
 */
interface SandboxHandle {
  runCommand(params: RunCommandParams & { detached: true }): Promise<Command>;
  runCommand(params: RunCommandParams): Promise<CommandFinished>;
}

/**
 * Options for {@link Containers.install}.
 */
export interface InstallContainerRuntimeOptions {
  /**
   * Reinstall even if a container runtime is already present.
   *
   * @defaultValue false
   */
  force?: boolean;
  /**
   * An AbortSignal to cancel the installation.
   */
  signal?: AbortSignal;
}

/**
 * Options for {@link Containers.start}.
 */
export interface StartContainerOptions {
  /**
   * Publish container ports to the sandbox host. Keys are host ports and
   * values are the container ports they map to, equivalent to
   * `run -p <host>:<container>`.
   *
   * @example
   * { 6379: 6379 }
   */
  ports?: Record<number, number>;
  /**
   * Bind mounts and named volumes, equivalent to `run -v <host>:<container>`.
   * Keys are the host path (relative paths are resolved against the sandbox
   * working directory and created if missing) or a named volume; values are
   * the mount path inside the container.
   *
   * @example
   * { "./redis-data": "/data" }
   */
  volumes?: Record<string, string>;
  /**
   * Environment variables to set inside the container.
   */
  env?: Record<string, string>;
  /**
   * Assign a name to the container (`run --name`).
   */
  name?: string;
  /**
   * Working directory inside the container (`run -w <cwd>`).
   */
  cwd?: string;
  /**
   * Override the command (and its arguments) run inside the container.
   * Appended after the image, equivalent to `run <image> <cmd...>`.
   */
  cmd?: string[];
  /**
   * Additional raw flags passed to `run` before the image, for options not
   * covered by the typed fields above (e.g. `["--restart", "always"]`).
   */
  flags?: string[];
  /**
   * Apply the default container setup. Currently this trusts the sandbox's
   * network policy proxy CA inside the container so HTTPS requests to proxied
   * domains don't fail with certificate errors: the proxy CA anchors are
   * bind-mounted (read-only) into the container's trust-source directories,
   * CA-related environment variables are set, and `update-ca-trust`/
   * `update-ca-certificates` is run inside the container to integrate them.
   *
   * Enabled by default. Set to `false` to start the container without any of
   * this automatic setup.
   *
   * @defaultValue true
   */
  defaults?: boolean;
  /**
   * An AbortSignal to cancel starting the container.
   */
  signal?: AbortSignal;
}

/**
 * A container running inside a {@link Sandbox}.
 *
 * Obtain one from {@link Containers.start} or {@link Containers.get}.
 *
 * @example
 * const container = await sandbox.containers.start("redis:latest", {
 *   ports: { 6379: 6379 },
 * });
 * const result = await container.exec("redis-cli", "PING");
 * console.log(await result.stdout()); // "PONG"
 *
 * @hideconstructor
 */
export class Container {
  /** @internal */
  private readonly sandbox: SandboxHandle;

  /**
   * The Docker-compatible CLI used to manage this container.
   * @internal
   */
  private readonly runtime: string;

  /**
   * The container ID.
   */
  public readonly id: string;

  /**
   * The image this container was created from.
   */
  public readonly image: string;

  /** @internal */
  constructor(params: {
    sandbox: SandboxHandle;
    id: string;
    image: string;
    runtime?: string;
  }) {
    this.sandbox = params.sandbox;
    this.id = params.id;
    this.image = params.image;
    this.runtime = params.runtime ?? DEFAULT_RUNTIME_CMD;
  }

  /**
   * Run a command inside the container and wait for it to finish.
   *
   * @param command - The executable to run inside the container.
   * @param args - Arguments to pass to the command.
   * @returns A {@link CommandFinished} once the command exits.
   *
   * @example
   * const result = await container.exec("redis-cli", "PING");
   * console.log(await result.stdout()); // "PONG"
   */
  async exec(command: string, ...args: string[]): Promise<CommandFinished> {
    return this.sandbox.runCommand({
      cmd: this.runtime,
      args: ["exec", this.id, command, ...args],
      sudo: true,
    });
  }

  /**
   * Start a previously stopped container.
   *
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   */
  async start(opts?: { signal?: AbortSignal }): Promise<void> {
    const result = await this.sandbox.runCommand({
      cmd: this.runtime,
      args: ["start", this.id],
      sudo: true,
      signal: opts?.signal,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `failed to start container ${this.id}: ${await result.stderr()}`,
      );
    }
  }

  /**
   * Stop the container.
   *
   * @param opts - Optional parameters.
   * @param opts.timeout - Seconds to wait before killing the container.
   * @param opts.signal - An AbortSignal to cancel the operation.
   */
  async stop(opts?: { timeout?: number; signal?: AbortSignal }): Promise<void> {
    const args = ["stop"];
    if (opts?.timeout !== undefined) {
      args.push("--time", String(opts.timeout));
    }
    args.push(this.id);
    const result = await this.sandbox.runCommand({
      cmd: this.runtime,
      args,
      sudo: true,
      signal: opts?.signal,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `failed to stop container ${this.id}: ${await result.stderr()}`,
      );
    }
  }

  /**
   * Remove the container.
   *
   * @param opts - Optional parameters.
   * @param opts.force - Force removal of a running container.
   * @param opts.signal - An AbortSignal to cancel the operation.
   */
  async remove(opts?: { force?: boolean; signal?: AbortSignal }): Promise<void> {
    const args = ["rm"];
    if (opts?.force) {
      args.push("-f");
    }
    args.push(this.id);
    const result = await this.sandbox.runCommand({
      cmd: this.runtime,
      args,
      sudo: true,
      signal: opts?.signal,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `failed to remove container ${this.id}: ${await result.stderr()}`,
      );
    }
  }

  /**
   * Fetch the container's logs, returning stdout and stderr combined as a
   * string.
   *
   * @param opts - Optional parameters.
   * @param opts.tail - Only return this many lines from the end of the logs.
   * @param opts.timestamps - Prefix each log line with a timestamp.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns The container logs.
   */
  async logs(opts?: {
    tail?: number;
    timestamps?: boolean;
    signal?: AbortSignal;
  }): Promise<string> {
    const args = ["logs"];
    if (opts?.tail !== undefined) {
      args.push("--tail", String(opts.tail));
    }
    if (opts?.timestamps) {
      args.push("--timestamps");
    }
    args.push(this.id);
    const result = await this.sandbox.runCommand({
      cmd: this.runtime,
      args,
      sudo: true,
      signal: opts?.signal,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `failed to read logs for container ${this.id}: ${await result.stderr()}`,
      );
    }
    return result.output();
  }
}

/**
 * Run containers inside a {@link Sandbox} using a Docker-compatible runtime.
 *
 * A runtime must be present in the sandbox. Call {@link Containers.install} to
 * install one, or create the sandbox from an image that already includes one.
 * Operations that need the runtime throw a
 * {@link ContainerRuntimeNotInstalledError} when none is available.
 *
 * @example
 * const sandbox = await Sandbox.create();
 * await sandbox.containers.install();
 * const container = await sandbox.containers.start("redis:latest", {
 *   ports: { 6379: 6379 },
 *   volumes: { "./redis-data": "/data" },
 * });
 * await container.exec("redis-cli", "PING");
 */
export class Containers {
  /** @internal */
  private readonly sandbox: SandboxHandle;

  /** @internal */
  private readonly _runtime: string;

  /** @internal */
  private readonly _daemon: string | null;

  /**
   * The Docker-compatible CLI used to manage containers. Defaults to `nerdctl`;
   * override via the constructor to use a different runtime (e.g. `docker` or
   * `podman`) that is preinstalled in the sandbox.
   */
  get runtime(): string {
    return this._runtime;
  }

  /**
   * The container runtime daemon the CLI talks to, started on demand. Defaults
   * to `containerd`; override to match {@link runtime}, or `null` for a
   * daemonless runtime (e.g. `podman`), in which case no daemon is started.
   */
  get daemon(): string | null {
    return this._daemon;
  }

  /**
   * Deduplicated promise that starts the runtime daemon.
   * @internal
   */
  private daemonReady: Promise<void> | null = null;

  /**
   * Cached sandbox working directory, used to resolve relative volume paths.
   * @internal
   */
  private cwdPromise: Promise<string> | null = null;

  /**
   * Deduplicated promise for {@link install}, so repeated and concurrent calls
   * share a single install.
   * @internal
   */
  private installPromise: Promise<void> | null = null;

  /** @internal */
  constructor(
    sandbox: SandboxHandle,
    options?: { runtime?: string; daemon?: string | null },
  ) {
    this.sandbox = sandbox;
    this._runtime = options?.runtime ?? DEFAULT_RUNTIME_CMD;
    // Distinguish an explicit `null` (daemonless) from an omitted option.
    this._daemon =
      options?.daemon === undefined ? DEFAULT_DAEMON_CMD : options.daemon;
  }

  /**
   * Install a container runtime into the sandbox via the system package
   * manager (`dnf install -y docker`), then start the daemon.
   *
   * Idempotent: the install is skipped when a runtime is already present and
   * concurrent or repeated calls share a single install. Pass `force: true`
   * to reinstall.
   *
   * Requires network egress to the package repositories.
   *
   * @param options - Install options.
   *
   * @example
   * await sandbox.containers.install();
   */
  async install(options?: InstallContainerRuntimeOptions): Promise<void> {
    // `force` always (re)installs and refreshes the shared result.
    if (options?.force) {
      this.installPromise = this.doInstall(options).catch((err) => {
        this.installPromise = null;
        throw err;
      });
      return this.installPromise;
    }
    // Otherwise install at most once; share with concurrent/repeat callers.
    if (!this.installPromise) {
      this.installPromise = this.doInstall(options).catch((err) => {
        // Reset so a later call can retry after a transient failure.
        this.installPromise = null;
        throw err;
      });
    }
    return this.installPromise;
  }

  /** @internal */
  private async doInstall(
    options?: InstallContainerRuntimeOptions,
  ): Promise<void> {
    const signal = options?.signal;

    if (options?.force || !(await this.hasRuntime(signal))) {
      const result = await this.sandbox.runCommand({
        sudo: true,
        cmd: "dnf",
        args: ["install", "-y", "docker"],
        signal,
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `failed to install docker: ${await result.stderr()}`,
        );
      }
    }

    await this.startDaemon(signal);
  }

  /**
   * Start a new container from an image.
   *
   * By default the sandbox's network proxy CA is trusted inside the container
   * (mounted into the trust anchors, exposed via CA env vars, and integrated
   * with `update-ca-trust`) so HTTPS to proxied domains works. Disable this
   * automatic setup with `defaults: false`.
   *
   * @param image - The image reference to run (e.g. `redis:latest`).
   * @param options - Container options.
   * @returns A {@link Container} handle for the running container.
   * @throws {@link ContainerRuntimeNotInstalledError} if no runtime is installed.
   *
   * @example
   * const container = await sandbox.containers.start("redis:latest", {
   *   ports: { 6379: 6379 },
   *   volumes: { "./redis-data": "/data" },
   * });
   */
  async start(
    image: string,
    options?: StartContainerOptions,
  ): Promise<Container> {
    const signal = options?.signal;
    await this.ensureRuntime(signal);

    const args = ["run", "-d"];

    if (options?.name) {
      args.push("--name", options.name);
    }

    if (options?.cwd) {
      args.push("-w", options.cwd);
    }

    for (const [hostPort, containerPort] of Object.entries(
      options?.ports ?? {},
    )) {
      args.push("-p", `${hostPort}:${containerPort}`);
    }

    const bindDirs: string[] = [];
    const mountTargets = new Set<string>();
    for (const [host, containerPath] of Object.entries(
      options?.volumes ?? {},
    )) {
      mountTargets.add(containerPath);
      // Treat values that look like paths as bind mounts; everything else is a
      // named volume that the runtime manages itself.
      if (host.startsWith("/") || host.startsWith(".")) {
        const source = await this.resolvePath(host, signal);
        bindDirs.push(source);
        args.push("-v", `${source}:${containerPath}`);
      } else {
        args.push("-v", `${host}:${containerPath}`);
      }
    }

    // Pre-create bind mount source directories so they are owned by the
    // sandbox user rather than created as root by the runtime.
    if (bindDirs.length > 0) {
      await this.sandbox.runCommand({
        cmd: "mkdir",
        args: ["-p", ...bindDirs],
        signal,
      });
    }

    // Trust the sandbox's network proxy CA inside the container, unless the
    // caller disabled the default setup. Mirrors how the platform injects the
    // CA into the sandbox itself: bind-mount the CA anchors (read-only), set CA
    // env vars, and (after start) run update-ca-trust to integrate them.
    const applyDefaults = options?.defaults !== false;
    if (applyDefaults) {
      for (const anchor of CA_ANCHOR_PATHS) {
        if (!mountTargets.has(anchor)) {
          args.push("-v", `${anchor}:${anchor}:ro`);
        }
      }
      // Point well-known tools/runtimes at the system bundle. Added before the
      // caller's env so explicit values take precedence.
      for (const [key, value] of Object.entries(CA_TRUST_ENV)) {
        args.push("-e", `${key}=${value}`);
      }
    }

    for (const [key, value] of Object.entries(options?.env ?? {})) {
      args.push("-e", `${key}=${value}`);
    }

    if (options?.flags) {
      args.push(...options.flags);
    }

    args.push(image);

    if (options?.cmd) {
      args.push(...options.cmd);
    }

    const result = await this.runCli(args, signal);
    if (result.exitCode !== 0) {
      throw new Error(
        `failed to start container from image "${image}": ${await result.stderr()}`,
      );
    }

    // `run -d` prints the full container ID on the last line of stdout.
    const id = (await result.stdout()).trim().split("\n").pop()?.trim();
    if (!id) {
      throw new Error(
        `failed to start container from image "${image}": could not determine container id`,
      );
    }

    // Best-effort: append the proxy CA to the container's system bundle so it
    // is trusted immediately. Ignored if it can't be written.
    if (applyDefaults) {
      await this.runCli(
        ["exec", id, "sh", "-c", APPEND_CA_COMMAND],
        signal,
      ).catch(() => {});
    }

    return new Container({
      sandbox: this.sandbox,
      id,
      image,
      runtime: this.runtime,
    });
  }

  /**
   * Get a {@link Container} handle for an existing container by ID or name
   * without starting a new one. No network request is made; the handle simply
   * targets the given container for subsequent operations.
   *
   * @param id - The container ID or name.
   * @param image - Optional image reference, for reference only.
   */
  get(id: string, image = ""): Container {
    return new Container({
      sandbox: this.sandbox,
      id,
      image,
      runtime: this.runtime,
    });
  }

  /**
   * List containers in the sandbox.
   *
   * @param opts - Optional parameters.
   * @param opts.all - Include stopped containers.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A list of containers with their ID, image, name, and status.
   */
  async list(opts?: {
    all?: boolean;
    signal?: AbortSignal;
  }): Promise<{ id: string; image: string; name: string; status: string }[]> {
    await this.ensureRuntime(opts?.signal);
    const args = [
      "ps",
      "--no-trunc",
      "--format",
      "{{.ID}}\t{{.Image}}\t{{.Names}}\t{{.Status}}",
    ];
    if (opts?.all) {
      args.push("-a");
    }
    const result = await this.runCli(args, opts?.signal);
    if (result.exitCode !== 0) {
      throw new Error(`failed to list containers: ${await result.stderr()}`);
    }
    const output = (await result.stdout()).trim();
    if (!output) {
      return [];
    }
    return output.split("\n").map((line) => {
      const [id, image, name, status] = line.split("\t");
      return { id, image, name, status };
    });
  }

  /**
   * Ensure a runtime is installed and the daemon is running. The daemon start
   * is shared between concurrent callers.
   * @internal
   */
  private async ensureRuntime(signal?: AbortSignal): Promise<void> {
    if (!(await this.hasRuntime(signal))) {
      throw new ContainerRuntimeNotInstalledError();
    }
    await this.startDaemon(signal);
  }

  /**
   * Whether a container runtime CLI is available on the PATH.
   * @internal
   */
  private async hasRuntime(signal?: AbortSignal): Promise<boolean> {
    const result = await this.sandbox.runCommand({
      cmd: "sh",
      args: ["-c", `command -v ${this.runtime} >/dev/null 2>&1`],
      signal,
    });
    return result.exitCode === 0;
  }

  /**
   * Start the containerd daemon and wait until the runtime is ready. The work
   * is performed once and shared between concurrent callers.
   * @internal
   */
  private startDaemon(signal?: AbortSignal): Promise<void> {
    if (!this.daemonReady) {
      this.daemonReady = this.doStartDaemon(signal).catch((err) => {
        // Reset so a later call can retry after a transient failure.
        this.daemonReady = null;
        throw err;
      });
    }
    return this.daemonReady;
  }

  /** @internal */
  private async doStartDaemon(signal?: AbortSignal): Promise<void> {
    // Daemonless runtime (e.g. podman): nothing to start.
    if (this.daemon === null) {
      return;
    }

    // The daemon may already be running.
    if ((await this.runCli(["info"], signal)).exitCode === 0) {
      return;
    }

    // Start the daemon in the background; it keeps running after this returns.
    await this.sandbox.runCommand({
      cmd: "sh",
      args: ["-c", `${this.daemon} > /tmp/${this.daemon}.log 2>&1`],
      sudo: true,
      detached: true,
      signal,
    });

    const deadline = Date.now() + RUNTIME_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if ((await this.runCli(["info"], signal)).exitCode === 0) {
        return;
      }
      await setTimeout(RUNTIME_POLL_INTERVAL_MS, undefined, { signal });
    }
    throw new Error("container runtime did not become ready in time");
  }

  /**
   * Resolve a host path to an absolute path. Relative paths are resolved
   * against the sandbox working directory.
   * @internal
   */
  private async resolvePath(
    path: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (path.startsWith("/")) {
      return posix.normalize(path);
    }
    const cwd = await this.cwd(signal);
    return posix.resolve(cwd, path);
  }

  /**
   * Get (and cache) the sandbox working directory.
   * @internal
   */
  private async cwd(signal?: AbortSignal): Promise<string> {
    if (!this.cwdPromise) {
      this.cwdPromise = (async () => {
        const result = await this.sandbox.runCommand({ cmd: "pwd", signal });
        return (await result.stdout()).trim();
      })().catch((err) => {
        this.cwdPromise = null;
        throw err;
      });
    }
    return this.cwdPromise;
  }

  /**
   * Run a runtime CLI command with root privileges.
   * @internal
   */
  private runCli(
    args: string[],
    signal?: AbortSignal,
  ): Promise<CommandFinished> {
    return this.sandbox.runCommand({
      cmd: this.runtime,
      args,
      sudo: true,
      signal,
    });
  }
}
