# sandbox

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
