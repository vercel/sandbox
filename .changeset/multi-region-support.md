---
"@vercel/sandbox": minor
"@vercel/sandbox-mock": minor
"sandbox": minor
---

Add multi-region support:

- New `region` and `failoverRegions` params on sandbox create and fork (SDK), and matching `--region` / `--failover-regions` flags on `sandbox create`, `fork`, `run`, and `sh` (CLI).
- `region` and `failoverRegions` are also accepted by `sandbox.update` (applied to the next session; pass `failoverRegions: []` to remove them), with matching `sandbox config region <name> <region>` and `sandbox config failover-regions <name> <region,...|none>` commands.
- Read-only `regions` getter on `Snapshot` and `failoverRegions` getter on `Sandbox`.
- `REGION` columns in `sandbox ls` and `sessions list`, `REGIONS` in `snapshots list`/`get`, `Region` and `Failover regions` rows in `sandbox config list`, plus a region line in the create/fork summary.
- The mock server honors `region`/`failoverRegions` on create, fork, and update. A fork copies each side independently, and failover regions that include a caller-provided region are rejected; an overlap with the default region is filtered on read.
