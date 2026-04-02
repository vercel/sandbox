# sandbox

## 3.0.0-beta.13

### Patch Changes

- Updated dependencies []:
  - @vercel/sandbox@2.0.0-beta.11

## 3.0.0-beta.12

### Minor Changes

- Support default snapshot expiration for persistent sandboxes

### Patch Changes

- Updated dependencies []:
  - @vercel/sandbox@2.0.0-beta.10

## 3.0.0-beta.11

### Patch Changes

- Default to `--sort-by=name` when using `--name-prefix` in `sandbox ls` ([#113](https://github.com/vercel/sandbox/pull/113))

## 3.0.0-beta.10

### Patch Changes

- Add support for updating tags and display tags in config

## 3.0.0-beta.9

### Minor Changes

- Move to cursor pagination. Support new sortyBy parameter for lists. Support new statusUpdatedAt filter

### Patch Changes

- Updated dependencies []:
  - @vercel/sandbox@2.0.0-beta.9

## 3.0.0-beta.8

### Patch Changes

- Updated dependencies []:
  - @vercel/sandbox@2.0.0-beta.8

## 3.0.0-beta.7

### Patch Changes

- Fix resume race-condition ([#97](https://github.com/vercel/sandbox/pull/97))

- Fix bug where the first ssh connection hang ([#98](https://github.com/vercel/sandbox/pull/98))

- Fix JsDocs, messages and double-error message bug ([#94](https://github.com/vercel/sandbox/pull/94))

- Updated dependencies [[`d4ac7da0362f06e9095261eb36f802cf2c862b6d`](https://github.com/vercel/sandbox/commit/d4ac7da0362f06e9095261eb36f802cf2c862b6d), [`851f5106054adb4ff61806dded1712bf9c917451`](https://github.com/vercel/sandbox/commit/851f5106054adb4ff61806dded1712bf9c917451)]:
  - @vercel/sandbox@2.0.0-beta.7

## 3.0.0-beta.6

### Minor Changes

- Rename sandbox to session, namedSandbox to sandbox

### Patch Changes

- Updated dependencies []:
  - @vercel/sandbox@2.0.0-beta.5

## 3.0.0-beta.5

### Patch Changes

- Add support for patch + delete v2 endpoints for named sandboxes.

- Updated dependencies [[`67d41ad2c78913125c25d86acd9ee6a505170ca1`](https://github.com/vercel/sandbox/commit/67d41ad2c78913125c25d86acd9ee6a505170ca1)]:
  - @vercel/sandbox@2.0.0-beta.4

## 3.0.0-beta.4

### Minor Changes

- Support new --stop option for exec/run, support new --name option for snaphosts list

- support new --name option for snapshots list, support new --stop option for run

## 3.0.0-beta.3

### Minor Changes

- Automatically scale memory to vcpu when updating

### Patch Changes

- Updated dependencies []:
  - @vercel/sandbox@2.0.0-beta.3

## 3.0.0-beta.2

### Minor Changes

- Refactor the sandbox update and deprecate old network-policy update

### Patch Changes

- Updated dependencies []:
  - @vercel/sandbox@2.0.0-beta.2

## 3.0.0-beta.1

### Major Changes

- Introduce long-lived sandboxes to the CLI

### Patch Changes

- Updated dependencies []:
  - @vercel/sandbox@2.0.0-beta.1

## 3.0.0-beta.0

### Major Changes

- Support named sandboxes

## 2.5.7

### Patch Changes

- Updated dependencies [[`cf13a34221c2b83c25c73d94929d05e0a697aecf`](https://github.com/vercel/sandbox/commit/cf13a34221c2b83c25c73d94929d05e0a697aecf), [`772989c59a3c27efa98153cdc54b6e35c1c15eae`](https://github.com/vercel/sandbox/commit/772989c59a3c27efa98153cdc54b6e35c1c15eae), [`184cd42d8d3b1ea1df354529cb6ba103a33e18d3`](https://github.com/vercel/sandbox/commit/184cd42d8d3b1ea1df354529cb6ba103a33e18d3), [`451c42efb94ab9c9dc330b4742071ac01008044d`](https://github.com/vercel/sandbox/commit/451c42efb94ab9c9dc330b4742071ac01008044d)]:
  - @vercel/sandbox@1.9.1

## 2.5.6

### Patch Changes

- Updated dependencies [[`957eda3c1b03035a672bfdeb0addf52c3c78f837`](https://github.com/vercel/sandbox/commit/957eda3c1b03035a672bfdeb0addf52c3c78f837)]:
  - @vercel/sandbox@1.9.0

## 2.5.5

### Patch Changes

- Updated dependencies [[`ac49096ea505d658d6e255780c663765e7a309af`](https://github.com/vercel/sandbox/commit/ac49096ea505d658d6e255780c663765e7a309af)]:
  - @vercel/sandbox@1.8.1

## 2.5.4

### Patch Changes

- Add `--env/-e` support to `sandbox create` to set default environment variables inherited by sandbox commands. ([#70](https://github.com/vercel/sandbox/pull/70))

- Updated dependencies [[`3aee2c734fc470fe41ee0c1fd9f4db6b83b3dcdc`](https://github.com/vercel/sandbox/commit/3aee2c734fc470fe41ee0c1fd9f4db6b83b3dcdc)]:
  - @vercel/sandbox@1.8.0

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
