# @vercel/sandbox-mock

## 3.0.0

### Major Changes

- Add support for Vercel Managed Images and deprecate the `runtime` option in the SDK and CLI. Runtime-based creation remains supported through the legacy v2 API; image-based and default creation use the v3 API. Passing both `runtime` and `image` is an error. ([#276](https://github.com/vercel/sandbox/pull/276))

  Sandboxes that do not specify an image now use `vercel/sandbox/universal`. The previous default was the `node24` runtime on Amazon Linux 2023. The new default is based on Ubuntu and includes Node.js 24, Bun, Python 3.14, coding agents, and common development and debugging tools.

  Existing `runtime` calls continue to work, it's recommended to migrate to Vercel managed images when possible:

  - Not using `runtime`: omit `image` to use the new Universal image, or set `image: "vercel/sandbox/node:24"` for an Ubuntu-based Node.js equivalent to the previous default.
  - Using `runtime: "node22"`: use `image: "vercel/sandbox/node:22"` for an Ubuntu-based equivalent.
  - Using `runtime: "node24"`: use `image: "vercel/sandbox/node:24"` for an Ubuntu-based equivalent.
  - Using `runtime: "node26"`: use `image: "vercel/sandbox/node:26"` for an Ubuntu-based equivalent.
  - Using `runtime: "python3.13"`: use `image: "vercel/sandbox/python:3.14"` for an Ubuntu-based equivalent, and note the Python version upgrade.

### Patch Changes

- Updated dependencies [[`5c9e2d5f34f20632ed5a1de1288e811b67b95423`](https://github.com/vercel/sandbox/commit/5c9e2d5f34f20632ed5a1de1288e811b67b95423)]:
  - @vercel/sandbox@3.0.0

## 2.9.2

### Patch Changes

- Updated dependencies [[`2bd5c12d0681ef93c530c97d35564d3d625fd0f3`](https://github.com/vercel/sandbox/commit/2bd5c12d0681ef93c530c97d35564d3d625fd0f3)]:
  - @vercel/sandbox@2.9.2

## 2.9.1

### Patch Changes

- Updated dependencies [[`fa487a36f7fa9e33b49ad57e996252b02270afc6`](https://github.com/vercel/sandbox/commit/fa487a36f7fa9e33b49ad57e996252b02270afc6)]:
  - @vercel/sandbox@2.9.1

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
