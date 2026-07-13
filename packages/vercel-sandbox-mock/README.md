# @vercel/sandbox-mock

Drop-in mock for `@vercel/sandbox`. Runs your sandbox code against an in-memory
implementation of the Vercel sandbox API instead of provisioning real
sandboxes, so tests stay fast and offline.

## How it works

The mock does **not** reimplement the SDK. It re-exports the real
`@vercel/sandbox` classes and injects a mocked `fetch` (plus dummy credentials)
into every entry point, so `Sandbox`, `Session`, `Command`, `FileSystem`,
`SandboxUser`, and `Snapshot` are the genuine SDK code — only the HTTP layer is
replaced. Requests to `/v2/sandboxes/**` are served from memory, and commands
run locally through [just-bash](https://github.com/vercel-labs/just-bash)
against an in-memory filesystem.

Because the real SDK runs unchanged, argument parsing, pagination, retries,
resume-after-stop, snapshots, forking, and multi-user orchestration all behave
exactly as they do in production.

## Install

```bash
pnpm add -D @vercel/sandbox-mock
```

`@vercel/sandbox` is a peer dependency.

## Usage

Import `Sandbox` from `@vercel/sandbox-mock` instead of `@vercel/sandbox` — the
API is identical:

```ts
import { Sandbox } from "@vercel/sandbox-mock";

const sandbox = await Sandbox.create();
const result = await sandbox.runCommand("echo", ["hello"]);
console.log(await result.stdout()); // "hello\n"
await sandbox.stop();
```

To keep existing `@vercel/sandbox` imports unchanged, alias the module in your
test setup:

```ts
// vitest.setup.ts
vi.mock("@vercel/sandbox", () => import("@vercel/sandbox-mock"));
```

### Command handlers

Some commands can't run under just-bash (e.g. `npm install`). Stub their output
with `command()`. The API follows [msw](https://mswjs.io/) — set defaults once,
override per-test with `use()`, and reset in `afterEach`:

```ts
import { Sandbox, setupSandbox, command } from "@vercel/sandbox-mock";
import { afterEach, test } from "vitest";

const server = setupSandbox(
  command("npm install", { stdout: "added 1 package\n", exitCode: 0 }),
  command(/^greet/, (args) => ({ stdout: `Hello ${args[0] ?? "world"}\n` })),
);

afterEach(() => server.resetHandlers());

test("handles install failure", async () => {
  server.use(command("npm install", { stderr: "ERR!\n", exitCode: 1 }));
  const sandbox = await Sandbox.create();
  const result = await sandbox.runCommand("npm", ["install"]);
  console.log(result.exitCode); // 1
});
```

Handler priority (first match wins): `use()` > `setupSandbox()`. Handlers that
don't match fall through to just-bash.

### File operations & cleanup

```ts
await using sandbox = await Sandbox.create(); // AsyncDisposable — auto-stops
await sandbox.writeFiles([{ path: "/app/index.ts", content: 'console.log("hi")' }]);
console.log(await sandbox.fs.readFile("/app/index.ts", "utf8"));
```

## Limitations

Command execution is just-bash, not a real Linux VM, so some behaviour differs
from a live sandbox:

- **Users/groups** are simulated in memory. Home-directory scoping, `$HOME`,
  relative paths, and group membership work, but there is no real permission
  isolation between users. `id -un` reports `vercel-sandbox`.
- **Command output is buffered**, not streamed live — `logs()` emits after the
  command finishes.
- **Coreutils and shell semantics** follow just-bash: 32-bit arithmetic, no job
  control (`&`), and a different command set than the production image.
- **Network access** is disabled; stub network-dependent commands with
  `command()`.

The `compat` test suite runs the same assertions against both the mock and a
live sandbox to keep the two aligned. The live variants run when
`RUN_INTEGRATION_TESTS=1` is set, with credentials taken from `.env.test` or
the environment (same convention as the `vercel-sandbox` package).

## Development

```bash
pnpm install
pnpm run test       # unit + integration + compat (mock)
RUN_INTEGRATION_TESTS=1 pnpm run test   # also run [real] compat tests
pnpm run typecheck
pnpm run build
```
