---
"@vercel/sandbox": minor
"@vercel/sandbox-mock": minor
"sandbox": minor
---

Add multi-region support:

- New `region` and `failoverRegions` options on sandbox create, fork, and update (SDK), with matching flags on `sandbox create`, `fork`, `run`, `sh`, and the `sandbox config region` / `sandbox config failover-regions` commands (CLI).
- New `failoverRegions` getter on `Sandbox` and `regions` getter on `Snapshot`.
- Regions are now shown in `sandbox ls`, `sessions list`, `snapshots list`/`get`, `sandbox config list`, and the create/fork summary.
