---
"@vercel/sandbox": minor
"@vercel/sandbox-mock": minor
"sandbox": minor
---

Add multi-region support:

- New `region` and `failoverRegions` params on sandbox create and fork (SDK), and matching `--region` / `--failover-region` flags on `sandbox create`, `fork`, `run`, and `sh` (CLI).
- Read-only `regions` getter on `Snapshot` and `failoverRegions` getter on `Sandbox`.
- `REGION` columns in `sandbox ls` and `sessions list`, `REGIONS` in `snapshots list`/`get`, plus a region line in the create/fork summary.
- The mock server honors `region`/`failoverRegions` on create and fork, and rejects failover regions that include the sandbox region.
