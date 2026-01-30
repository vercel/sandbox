# sandbox

## 2.2.0

### Minor Changes

- - `sandbox ssh <sandbox_id>` is now `sandbox connect <sandbox_id>`. Aliases are: `shell`, `ssh` for backward compact ([#27](https://github.com/vercel/sandbox/pull/27))
  - `sandbox sh` is now `sandbox create --connect`

  If the user runs `sandbox sh ...`, we also try to remap automatically to `sandbox create --connect` and print a warning

### Patch Changes

- parse API error response message from JSON body ([#24](https://github.com/vercel/sandbox/pull/24))

- Updated dependencies [[`c666c245aa1af3bd1e1b516dc6d4620b04576c35`](https://github.com/vercel/sandbox/commit/c666c245aa1af3bd1e1b516dc6d4620b04576c35)]:
  - @vercel/sandbox@1.4.1

## 2.1.0

### Minor Changes

- Add support for network policies ([#22](https://github.com/vercel/sandbox/pull/22))

### Patch Changes

- Updated dependencies [[`a29131ecd3c7479b6eac5e2f2f0225523d41011b`](https://github.com/vercel/sandbox/commit/a29131ecd3c7479b6eac5e2f2f0225523d41011b)]:
  - @vercel/sandbox@1.4.0

## 2.0.4

### Patch Changes

- Display team and project info in a framed format after sandbox creation ([#18](https://github.com/vercel/sandbox/pull/18))

## 2.0.3

### Patch Changes

- use a new OIDC token when refreshed, instead of relying on the old OIDC token pre-refresh ([#13](https://github.com/vercel/sandbox/pull/13))

- Updated dependencies [[`01c8a27a874b772e7819051176a1345153d49e03`](https://github.com/vercel/sandbox/commit/01c8a27a874b772e7819051176a1345153d49e03)]:
  - @vercel/sandbox@1.3.2

## 2.0.2

### Patch Changes

- Add support for snapshots: ([#6](https://github.com/vercel/sandbox/pull/6))
  ```
  sandbox snapshot --stop <sandbox-id>
  sandbox create --snapshot <snapshot-id>
  sandbox snapshots list
  sandbox snapshot delete <snapshot-id>
  ```
