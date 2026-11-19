---
"sandbox": minor
"@vercel/sandbox": minor
---

Add `architecture` to `Sandbox.create` and `--architecture` to `create`, `run`, and `sh`, to choose `amd64` or `arm64` for a sandbox. `sandbox.architecture` reports the architecture a sandbox runs on, and `sandbox ls` shows it in an `ARCH` column. `arm64` is in beta and available only in `iad1`.
