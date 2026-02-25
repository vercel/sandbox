# sandbox

## 2.5.3

### Patch Changes

- Add `--vcpus` flag to `create` and `run` commands for configuring sandbox resources. ([#65](https://github.com/vercel/sandbox/pull/65))

- Fix copying files to local path when not already present ([#64](https://github.com/vercel/sandbox/pull/64))

## 2.5.2

### Patch Changes

- Fix 400 errors on interactions (connect, run-command, etc) ([#62](https://github.com/vercel/sandbox/pull/62))

- Updated dependencies [[`b35a70030c0c58da49410aa599e1b2eecaad0438`](https://github.com/vercel/sandbox/commit/b35a70030c0c58da49410aa599e1b2eecaad0438)]:
  - @vercel/sandbox@1.7.1

## 2.5.1

### Patch Changes

- Fix 400 errors on interactions (connect, run-command, etc) ([#60](https://github.com/vercel/sandbox/pull/60))

## 2.5.0

### Minor Changes

- Add resource usage for stopped sandboxes. ([#54](https://github.com/vercel/sandbox/pull/54))
  Add blocking mode for `stop` function.

### Patch Changes

- Update to use `@vercel/oidc@3.2.0` utilities, removing duplicate auth logic and the local `JwtExpiry` class ([#34](https://github.com/vercel/sandbox/pull/34))

- Updated dependencies [[`376a098243dddcee56c657b97856a0cd199113e0`](https://github.com/vercel/sandbox/commit/376a098243dddcee56c657b97856a0cd199113e0), [`46f0ed22f7128355942037321df70dc93481a50d`](https://github.com/vercel/sandbox/commit/46f0ed22f7128355942037321df70dc93481a50d), [`659c40e719b21740024ede84c176257714f0086b`](https://github.com/vercel/sandbox/commit/659c40e719b21740024ede84c176257714f0086b), [`35195578e5b5f68e7f9574b728ca7ff350bbad64`](https://github.com/vercel/sandbox/commit/35195578e5b5f68e7f9574b728ca7ff350bbad64)]:
  - @vercel/sandbox@1.7.0

## 2.4.0

### Minor Changes

- Add `sandbox snapshots get <snapshot_id>` command to retrieve details of a specific snapshot ([#44](https://github.com/vercel/sandbox/pull/44))

- Add support for custom/infinite snapshots expiration ([#36](https://github.com/vercel/sandbox/pull/36))

### Patch Changes

- Fix table output not using the same width for each row ([#45](https://github.com/vercel/sandbox/pull/45))

- change help format to match Vercel CLI h/t @allenzhou101 ([#47](https://github.com/vercel/sandbox/pull/47))

- Updated dependencies [[`5b5f488db3fe7b8a7dad5d784617c5787e9ac1c0`](https://github.com/vercel/sandbox/commit/5b5f488db3fe7b8a7dad5d784617c5787e9ac1c0)]:
  - @vercel/sandbox@1.6.0

## 2.3.0

### Minor Changes

- Use new model for network-policies ([#33](https://github.com/vercel/sandbox/pull/33))

### Patch Changes

- Add aborted status to sandboxes ([`863637edae310f867c224cbd60958edda51f51a5`](https://github.com/vercel/sandbox/commit/863637edae310f867c224cbd60958edda51f51a5))

- Updated dependencies [[`d36a202fbfa227d1b31b3bab83de510caad9afc9`](https://github.com/vercel/sandbox/commit/d36a202fbfa227d1b31b3bab83de510caad9afc9), [`8a2d58d5a87a7a53bae1fad705538bbbbc1cffef`](https://github.com/vercel/sandbox/commit/8a2d58d5a87a7a53bae1fad705538bbbbc1cffef), [`be9a26007aa51c735f6513f9bd78acceec6aec1c`](https://github.com/vercel/sandbox/commit/be9a26007aa51c735f6513f9bd78acceec6aec1c), [`863637edae310f867c224cbd60958edda51f51a5`](https://github.com/vercel/sandbox/commit/863637edae310f867c224cbd60958edda51f51a5)]:
  - @vercel/sandbox@1.5.0

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
