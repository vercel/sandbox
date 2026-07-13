# @vercel/sandbox-mock

Drop-in mock for the current `@vercel/sandbox` API backed by [just-bash](https://github.com/vercel-labs/just-bash). Runs commands locally instead of spinning up real sandboxes, so tests stay fast and offline.

## Install

```bash
pnpm add @vercel/sandbox-mock
```

## Usage

Use `vi.mock` to replace `@vercel/sandbox` with `@vercel/sandbox-mock` so your existing imports work without changes:

```ts
// vitest.setup.ts (or top of your test file)
vi.mock("@vercel/sandbox", async () => import("@vercel/sandbox-mock"));
```

Then use `@vercel/sandbox` as normal in your code and tests — the mock is substituted automatically:

```ts
import { Sandbox } from "@vercel/sandbox";

const sandbox = await Sandbox.create();
const result = await sandbox.runCommand("echo", ["hello"]);
console.log(await result.stdout()); // "hello\n"
await sandbox.stop();
```

### Command handlers

Stub specific commands to control their output in tests. The handler API follows the same pattern as [msw](https://mswjs.io/) — set defaults once, override per-test with `use()`, and reset in `afterEach`.

```ts
import { setupSandbox, command } from "@vercel/sandbox-mock";
import { Sandbox } from "@vercel/sandbox";
import { afterEach } from "vitest";

const sandboxMock = setupSandbox(
  command("npm install", { stdout: "added 1 package\n", exitCode: 0 }),
  command(/^greet/, (args) => ({
    stdout: `Hello ${args[0] ?? "world"}\n`,
    exitCode: 0,
  })),
);

afterEach(() => sandboxMock.resetHandlers());
```

Tests use defaults automatically:

```ts
test("runs npm install", async () => {
  const sb = await Sandbox.create();
  const result = await sb.runCommand("npm", ["install", "react"]);
  console.log(await result.stdout()); // "added 1 package\n"
});
```

Override specific handlers per-test with `sandboxMock.use()`:

```ts
test("handles install failure", async () => {
  sandboxMock.use(command("npm install", { stderr: "ERR!\n", exitCode: 1 }));

  const sb = await Sandbox.create();
  const result = await sb.runCommand("npm", ["install"]);
  console.log(result.exitCode); // 1
});
// afterEach calls resetHandlers() — next test gets defaults again
```

Handlers can also be passed directly to `Sandbox.create()` for per-instance behavior:

```ts
const sb = await Sandbox.create({
  handlers: [command("custom-tool", { stdout: "ok\n" })],
});
```

Handler priority (first match wins): `use()` > `create({ handlers })` > `setupSandbox()`

### File operations

```ts
const sandbox = await Sandbox.create();

await sandbox.writeFiles([{ path: "/app/index.ts", content: Buffer.from('console.log("hi")') }]);

const stream = await sandbox.readFile({ path: "/app/index.ts" });
```

### Cleanup

`Sandbox.create()` returns an `AsyncDisposable`, so you can use `await using` for automatic cleanup:

```ts
await using sandbox = await Sandbox.create();
// sandbox.stop() called automatically
```

## Supported API

| Method                                               | Behavior                                               |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `Sandbox.create()` / `Sandbox.getOrCreate()`         | Creates or reuses a local just-bash sandbox            |
| `Sandbox.fork()`                                     | Copies a sandbox filesystem and runtime configuration  |
| `runCommand()`                                       | Executes via just-bash (supports pipes, detached mode) |
| `writeFiles()` / `readFile()` / `readFileToBuffer()` | In-memory filesystem                                   |
| `mkDir()`                                            | Creates directories                                    |
| `domain(port)`                                       | Returns a mock URL for configured ports                |
| `currentSession()`                                   | Returns the active local session                       |
| `stop()` / `delete()`                                | Stops or deletes the sandbox                           |
| `snapshot()`                                         | Returns a stub `Snapshot`                              |
| `Snapshot.tree()`                                    | Returns a mock paginated ancestry tree                 |
| `update()` / `extendTimeout()`                       | Updates local state                                    |
| `updateNetworkPolicy()`                              | Updates the local network policy                       |
| `createUser()` / `asUser()` / `SandboxUser`          | Simulated users; scope file/command ops to a home dir  |
| `createGroup()` / `addUserToGroup()` / `removeUserFromGroup()` | Simulated groups with a `/shared/<group>` dir |
| `setupSandbox(...handlers)`                          | Set default handlers, returns `{ use, resetHandlers }` |
| `sandboxMock.use(...handlers)`                       | Prepend runtime handler overrides                      |
| `sandboxMock.resetHandlers()`                        | Clear `use()` overrides, keep defaults                 |
| `Sandbox.list()` / `Sandbox.get()`                   | Lists and retrieves tracked local sandboxes            |
| `sandbox.fs` / `FileSystem`                          | Node-style filesystem facade and exported class        |
| `defineSandboxProxy()`                               | Verifies and reconstructs forwarded sandbox requests   |

## Limitations

`just-bash` has no real Linux user system, so multi-user support is a best-effort
simulation: relative paths, home directories (`SandboxUser.homeDir`, `pwd`, `$HOME`)
and group membership are tracked in-memory, but `whoami` reports the underlying
shell user and OS-level permission isolation between users is not enforced. Behavior
that depends on true user identity only holds against a real sandbox.

## Type safety

The mock includes compile-time checks against `@vercel/sandbox` types so API drift is caught at build time.

## Development

```bash
pnpm install     # Install dependencies
pnpm run test    # Run tests
pnpm run build   # Build the library
```
