# @vercel/sandbox-mock

## 2.9.0

### Patch Changes

- Updated dependencies [[`80974e511e4ba755c70851bc5c8a5c0e9b8e7177`](https://github.com/vercel/sandbox/commit/80974e511e4ba755c70851bc5c8a5c0e9b8e7177)]:
  - @vercel/sandbox@2.9.0

## 2.8.0

### Minor Changes

- Add `@vercel/sandbox-mock`, a drop-in mock for `@vercel/sandbox` backed by `just-bash`. Rather than reimplementing the SDK surface, it runs the real `@vercel/sandbox` classes against an in-memory implementation of the `/v2/sandboxes` HTTP API injected through the SDK's `fetch` seam — so command execution, filesystem, multi-user/group management, snapshots, and forking all exercise the real SDK code. Commands run locally via `just-bash` against an in-memory filesystem, and `command()`/`setupSandbox()` let tests stub the output of commands `just-bash` can't run. ([#245](https://github.com/vercel/sandbox/pull/245))

  As part of this, `Snapshot.get` now forwards a custom `fetch` (via `WithFetchOptions`), matching `Snapshot.list` and `Snapshot.tree`. Previously it always used the global `fetch`, so an injected client — such as the mock — could not intercept the request.

### Patch Changes

- Re-export `SandboxUserAlreadyExistsError` from `@vercel/sandbox-mock` so the mock's public surface matches the real SDK. ([#256](https://github.com/vercel/sandbox/pull/256))

- Updated dependencies [[`96aa20fa031fff84c732c045ab68976034ae3d35`](https://github.com/vercel/sandbox/commit/96aa20fa031fff84c732c045ab68976034ae3d35)]:
  - @vercel/sandbox@2.8.0
