---
"@vercel/sandbox": minor
"sandbox": minor
---

Add `Sandbox.fork(...)` to the SDK and `sandbox fork <source>` to the CLI for forking an existing sandbox into a new one. The fork copies as many config parameters as the server exposes — `resources` (vcpus), `timeout`, `networkPolicy`, `tags`, `ports`, `persistent`, `snapshotExpiration`, `keepLastSnapshots` — and lets the caller override any of them. Environment variables are not copied (encrypted server-side) and must be re-supplied via `env` / `--env`.

**Breaking**: removed `sandbox create --sandbox-snapshot <name>` and `Snapshot.fromSandbox(name)`. Use `sandbox fork <name>` / `Sandbox.fork({ sourceSandbox: name })` instead. Raw snapshot IDs are still supported via `sandbox create --snapshot <id>` and `Sandbox.create({ source: { type: "snapshot", snapshotId } })`.
