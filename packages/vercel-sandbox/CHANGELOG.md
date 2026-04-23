# @vercel/sandbox

## 2.0.0-beta.16

### Minor Changes

- Support pagination (CLI and SDK) when listing sandboxes, snapshots, sessions

## 2.0.0-beta.15

### Minor Changes

- Remove support for blocking parameter in .stop() and default to always blocking. Improve CLI output when stopping a sandbox.

## 2.0.0-beta.14

### Patch Changes

- Support updading current-snapshot-id of an existing sandbox

## 2.0.0-beta.13

### Minor Changes

- Support new onResume parameter in Sandbox.create and Sandbox.get

## 2.0.0-beta.12

### Minor Changes

- Rebase from main

## 2.0.0-beta.11

### Patch Changes

- Fix an 422 error when trying to resume a sandbox after snapshotting

## 2.0.0-beta.10

### Minor Changes

- Support default snapshot expiration for persistent sandboxes

## 2.0.0-beta.9

### Minor Changes

- Move to cursor pagination. Support new sortyBy parameter for lists. Support new statusUpdatedAt filter

## 2.0.0-beta.8

### Patch Changes

- Fix an error with resuming while reading a file

## 2.0.0-beta.7

### Patch Changes

- Fix bug where the first ssh connection hang ([#98](https://github.com/vercel/sandbox/pull/98))

- Fix JsDocs, messages and double-error message bug ([#94](https://github.com/vercel/sandbox/pull/94))

## 2.0.0-beta.6

### Minor Changes

- Lists now unwrap the json and return the items and pagination fields directly ([#92](https://github.com/vercel/sandbox/pull/92))

### Patch Changes

- Add support for tags

## 2.0.0-beta.5

### Minor Changes

- Rename sandbox to session, namedSandbox to sandbox

## 2.0.0-beta.4

### Patch Changes

- Add support for patch + delete v2 endpoints for named sandboxes. ([#85](https://github.com/vercel/sandbox/pull/85))

## 2.0.0-beta.3

### Minor Changes

- Automatically scale memory to vcpu when updating

## 2.0.0-beta.2

### Minor Changes

- Refactor the sandbox update and deprecate old network-policy update

## 2.0.0-beta.1

### Minor Changes

- Rename snapshotOnShutdown to persistent

## 2.0.0-beta.0

### Major Changes

- Introduce named and long-lived sandboxes ([`7407ec9ec419144ae49b0eb2704cb5cf2267b7f3`](https://github.com/vercel/sandbox/commit/7407ec9ec419144ae49b0eb2704cb5cf2267b7f3))

## 1.10.0

### Minor Changes

- Expose Filesystem api from Sandbox ([#112](https://github.com/vercel/sandbox/pull/112))

### Patch Changes

- Reuse Undici `Agent` across instances ([#143](https://github.com/vercel/sandbox/pull/143))

- Smarter fallback team selection for scope inference: tries `defaultTeamId` first, then the best hobby-plan OWNER team (personal team or most recently updated). Filters fallback candidates by `billing.plan === 'hobby'` to avoid selecting pro/enterprise teams. Skips teams that return 403 and shows a helpful error when no team allows sandbox creation. ([#120](https://github.com/vercel/sandbox/pull/120))

- Add workflow serialization support for the `Snapshot` class via `WORKFLOW_SERIALIZE` / `WORKFLOW_DESERIALIZE`, fixing serialization errors when a `Snapshot` instance is returned from a workflow step. ([#140](https://github.com/vercel/sandbox/pull/140))

## 1.9.3

### Patch Changes

- Handle abort signal and early stream close in runCommand to avoid misleading Zod error ([#135](https://github.com/vercel/sandbox/pull/135))

## 1.9.2

### Patch Changes

- Fix `stdout()`/`stderr()`/`output()` failing on deserialized `Command` instances with "logs() requires an API client" error. ([#130](https://github.com/vercel/sandbox/pull/130))

## 1.9.1

### Patch Changes

- Build and publish both ESM and CJS outputs for the SDK package. ([#84](https://github.com/vercel/sandbox/pull/84))

- Support useworkflow serialization for sandboxes and commands ([#72](https://github.com/vercel/sandbox/pull/72))

- Fix a Size mismatch when encoding binaries during write operations ([#127](https://github.com/vercel/sandbox/pull/127))

- Accept `string` and `Uint8Array` in `writeFiles()` content, not just `Buffer`. ([#128](https://github.com/vercel/sandbox/pull/128))

## 1.9.0

### Minor Changes

- Add support for setting file permissions (mode) in the `writeFiles` API. Files can now include an optional `mode` property to set permissions on the tarball, avoiding the need for a separate `chmod` command. ([#90](https://github.com/vercel/sandbox/pull/90))

  ```ts
  await sandbox.writeFiles([
    {
      path: "/usr/local/bin/myscript",
      content: Buffer.from("#!/bin/bash\necho hello"),
      mode: 0o755,
    },
  ]);
  ```

## 1.8.1

### Patch Changes

- Fix unhandled promise rejection when running a command while the sandbox is stopping ([#82](https://github.com/vercel/sandbox/pull/82))

## 1.8.0

### Minor Changes

- Add support for default environment variables in `Sandbox.create()`. These environment variables are inherited by all commands unless overridden with the `env` option in `runCommand`. ([#70](https://github.com/vercel/sandbox/pull/70))

  ```ts
  const sandbox = await Sandbox.create({
    env: { HELLO: "world" },
  });

  // All commands will have HELLO=world
  await sandbox.runCommand("bash", ["-c", 'echo "Hello $HELLO"']);
  ```

## 1.7.1

### Patch Changes

- Fix 400 errors on interactions (connect, run-command, etc) ([#62](https://github.com/vercel/sandbox/pull/62))

## 1.7.0

### Minor Changes

- Support passing private params in all API calls ([#52](https://github.com/vercel/sandbox/pull/52))

- Add resource usage for stopped sandboxes. ([#54](https://github.com/vercel/sandbox/pull/54))
  Add blocking mode for `stop` function.

- Adds transformers to network policy and support for header injections. ([#53](https://github.com/vercel/sandbox/pull/53))

### Patch Changes

- Update to use `@vercel/oidc@3.2.0` utilities, removing duplicate auth logic and the local `JwtExpiry` class ([#34](https://github.com/vercel/sandbox/pull/34))

## 1.6.0

### Minor Changes

- Add support for custom/infinite snapshots expiration ([#36](https://github.com/vercel/sandbox/pull/36))

## 1.5.0

### Minor Changes

- Use new model for network-policies ([#33](https://github.com/vercel/sandbox/pull/33))

### Patch Changes

- Add network policy getter on Sandbox instance ([#41](https://github.com/vercel/sandbox/pull/41))

- The `downloadFile` method now throws a clear error when src or dst path is missing, instead of failing with a cryptic exception. ([#37](https://github.com/vercel/sandbox/pull/37))

- Add aborted status to sandboxes ([`863637edae310f867c224cbd60958edda51f51a5`](https://github.com/vercel/sandbox/commit/863637edae310f867c224cbd60958edda51f51a5))

## 1.4.1

### Patch Changes

- Add sizeBytes, createdAt and expiresAt getters on the Snapshot class ([#26](https://github.com/vercel/sandbox/pull/26))

## 1.4.0

### Minor Changes

- Add support for network policies ([#22](https://github.com/vercel/sandbox/pull/22))

## 1.3.2

### Patch Changes

- add an env var to make code more testable ([#13](https://github.com/vercel/sandbox/pull/13))
