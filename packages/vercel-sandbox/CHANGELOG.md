# @vercel/sandbox

## 1.3.1

### Patch Changes

- Add Snapshot.list() support ([#251](https://github.com/vercel/sandbox-sdk/pull/251))

## 1.3.0

### Minor Changes

- Deprecate @vercel/sandbox-cli ([#250](https://github.com/vercel/sandbox-sdk/pull/250))

### Patch Changes

- export APIError ([#248](https://github.com/vercel/sandbox-sdk/pull/248))

## 1.2.1

### Patch Changes

- Handle non ND-JSON responses gracefully ([#244](https://github.com/vercel/sandbox-sdk/pull/244))

- Fix file publishing ([#249](https://github.com/vercel/sandbox-sdk/pull/249))

## 1.2.0

### Minor Changes

- Adds two methods for interacting with files: `Sandbox#readFileToBuffer` and `Sandbox#downloadFile` ([#236](https://github.com/vercel/sandbox-sdk/pull/236))

### Patch Changes

- Improve performance of `runCommand` when not using `detached` ([#243](https://github.com/vercel/sandbox-sdk/pull/243))

## 1.1.9

### Patch Changes

- rename internal property outputCachePromise to outputCache, removing the old outputCache which was the unwrapped version of the promise. ([#230](https://github.com/vercel/sandbox-sdk/pull/230))

- Update OIDC error messages ([#234](https://github.com/vercel/sandbox-sdk/pull/234))

- support `await using sbx = await Sandbox.create()` ([#203](https://github.com/vercel/sandbox-sdk/pull/203))

## 1.1.8

### Patch Changes

- Improve CLI error messages and support env var punning (`-e VAR`) ([#231](https://github.com/vercel/sandbox-sdk/pull/231))

## 1.1.7

### Patch Changes

- Change default runtime to node24 ([#212](https://github.com/vercel/sandbox-sdk/pull/212))

## 1.1.6

### Patch Changes

- Fixed race in stdout/stderr buffering ([#213](https://github.com/vercel/sandbox-sdk/pull/213))

## 1.1.5

### Patch Changes

- prompt to login on local machines to make it seamless to use ([#185](https://github.com/vercel/sandbox-sdk/pull/185))

## 1.1.4

### Patch Changes

- Update @vercel/oidc to 3.1.0 ([#204](https://github.com/vercel/sandbox-sdk/pull/204))

## 1.1.3

### Patch Changes

- don't require projectId in Sandbox.list ([#200](https://github.com/vercel/sandbox-sdk/pull/200))

- add Sandbox.createdAt Date property ([#192](https://github.com/vercel/sandbox-sdk/pull/192))

- Add support for stream errors ([#183](https://github.com/vercel/sandbox-sdk/pull/183))

## 1.1.2

### Patch Changes

- allow Sandbox.list to omit the argument ([#186](https://github.com/vercel/sandbox-sdk/pull/186))

## 1.1.1

### Patch Changes

- Add experimental support for snapshots ([#162](https://github.com/vercel/sandbox-sdk/pull/162))

## 1.1.0

### Minor Changes

- Add support for node24 runtime. ([#179](https://github.com/vercel/sandbox-sdk/pull/179))

### Patch Changes

- allow to override the fetch implementation ([#177](https://github.com/vercel/sandbox-sdk/pull/177))

## 1.0.4

### Patch Changes

- add jsdoc example for sandbox.extendTimeout ([#171](https://github.com/vercel/sandbox-sdk/pull/171))

- change license to MIT (more permissive, therefore not breaking change) ([#169](https://github.com/vercel/sandbox-sdk/pull/169))

- when streaming stdout/stderr on command creation, don't throw AbortError when AbortSignal is done. Instead silently exit the loop. It's fine. ([#172](https://github.com/vercel/sandbox-sdk/pull/172))

- Make interactive sandbox command execution use WebSocket instead of WebRTC to support more diverse network conditions. ([#164](https://github.com/vercel/sandbox-sdk/pull/164))

## 1.0.3

### Patch Changes

- upgrade `@vercel/oidc` to version 3.0.5 to fix OIDC expiry bug (see https://github.com/vercel/vercel/pull/14306) ([#165](https://github.com/vercel/sandbox-sdk/pull/165))

## 1.0.0

## 1.0.0-beta.0

### Major Changes

- starting a beta ([#147](https://github.com/vercel/sandbox-sdk/pull/147))

## 0.0.24

### Patch Changes

- Change base URL to vercel.com/api ([#150](https://github.com/vercel/sandbox-sdk/pull/150))

## 0.0.23

### Patch Changes

- Add `Sandbox.extendTimeout()` ([#148](https://github.com/vercel/sandbox-sdk/pull/148))

## 0.0.22

### Patch Changes

- add AbortSignal support in public interface ([#137](https://github.com/vercel/sandbox-sdk/pull/137))

- add AbortSignal support to command.wait ([#136](https://github.com/vercel/sandbox-sdk/pull/136))

## 0.0.21

### Patch Changes

- Disable Undici body timeout ([#126](https://github.com/vercel/sandbox-sdk/pull/126))

## 0.0.20

### Patch Changes

- Update max timeouts limit ([#125](https://github.com/vercel/sandbox-sdk/pull/125))

## 0.0.19

### Patch Changes

- https://github.com/vercel/sandbox-sdk/pull/104/files introduced `Sandbox.list` ([#119](https://github.com/vercel/sandbox-sdk/pull/119))

- support interrupting the log consuming ([#123](https://github.com/vercel/sandbox-sdk/pull/123))

  - using [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) with `cmd.logs({ signal })`
  - using [`Disposable`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using) with `using logs = cmd.logs()`

## 0.0.18

### Patch Changes

- refresh oidc token if stale in development ([#106](https://github.com/vercel/sandbox-sdk/pull/106))

## 0.0.17

### Patch Changes

- Sandboxes can now expose up to 4 ports ([#99](https://github.com/vercel/sandbox-sdk/pull/99))

  This applies to all SDK versions, but this SDK release documents the limit.

- Fix bug in Sandbox.writeFile, add support for absolute paths ([#97](https://github.com/vercel/sandbox-sdk/pull/97))

## 0.0.16

### Patch Changes

- Add sandbox.status property ([#95](https://github.com/vercel/sandbox-sdk/pull/95))

## 0.0.15

### Patch Changes

- Remove warning when consuming logs more than once ([#91](https://github.com/vercel/sandbox-sdk/pull/91))

- Improve future compatibility of runtime parameter ([#88](https://github.com/vercel/sandbox-sdk/pull/88))

## 0.0.14

### Patch Changes

- Use `@vercel/oidc` for authentication ([#87](https://github.com/vercel/sandbox-sdk/pull/87))

- Expose more data in `Command` ([#85](https://github.com/vercel/sandbox-sdk/pull/85))

## 0.0.13

### Patch Changes

- Add sudo support to running commands ([#72](https://github.com/vercel/sandbox-sdk/pull/72))

## 0.0.12

### Patch Changes

- Fix installation with `npm` on Node 22

## 0.0.11

### Patch Changes

- Rename `stream` to `content` when writing files ([#60](https://github.com/vercel/sandbox-sdk/pull/60))

## 0.0.10

### Patch Changes

- Add `readFile` and fix a bug writing files to a Sandbox ([#54](https://github.com/vercel/sandbox-sdk/pull/54))

- Remove unused `routes` parameter from getSandbox ([#59](https://github.com/vercel/sandbox-sdk/pull/59))

## 0.0.9

### Patch Changes

- Add `cmd.kill()` to stop/signal commands ([#48](https://github.com/vercel/sandbox-sdk/pull/48))
- Update SDK to use the new API ([#51](https://github.com/vercel/sandbox-sdk/pull/51))

## 0.0.8

### Patch Changes

- Write files using a single compressed stream ([#44](https://github.com/vercel/sandbox-sdk/pull/44))
- Expose `runtime` parameter ([#46](https://github.com/vercel/sandbox-sdk/pull/46))
- Add git depth and revision options to sandbox source ([#47](https://github.com/vercel/sandbox-sdk/pull/47))

## 0.0.7

### Patch Changes

- Rename `cores` to `vcpus` ([#41](https://github.com/vercel/sandbox-sdk/pull/41))

## 0.0.6

### Patch Changes

- Better types for `Command` allowing a shorcut for waiting ([#29](https://github.com/vercel/sandbox-sdk/pull/29))

- Remove `SDK` and simplify API surface ([#38](https://github.com/vercel/sandbox-sdk/pull/38))

## 0.0.5

### Patch Changes

- Allow specifying env vars and cwd when running commands ([#25](https://github.com/vercel/sandbox-sdk/pull/25))

- createSandbox: do not require ports to be specified ([#27](https://github.com/vercel/sandbox-sdk/pull/27))

## 0.0.4

### Patch Changes

- Rename `SandboxSDK` to `SDK` and incorporate `projectId` as a required parameter ([#21](https://github.com/vercel/sandbox-sdk/pull/21))

## 0.0.3

### Patch Changes

- Do not include dev scripts in package output ([#16](https://github.com/vercel/sandbox-sdk/pull/16))

## 0.0.2

### Patch Changes

- Include user-agent HTTP header ([#13](https://github.com/vercel/sandbox-sdk/pull/13))

## 0.0.1

### Patch Changes

- Initial release ([#11](https://github.com/vercel/sandbox-sdk/pull/11))
