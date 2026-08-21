---
"sandbox": patch
---

Accept `none` for `--failover-regions` on `sandbox create`, `sandbox run` and `sandbox fork`.

`sandbox config failover-regions <name> none` already clears the list, but at creation time
`none` was forwarded as a literal region name and rejected by the API. With a project-level
default failover list there was no way to create a sandbox in one of those regions from the
CLI, while the SDK and the HTTP API both accept an empty `failoverRegions` array.

The `none` sentinel is now shared between `create`/`run`/`fork` and `config`.
