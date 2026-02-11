# @vercel/sandbox

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
