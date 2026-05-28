---
"@vercel/sandbox": minor
"sandbox": minor
---

Add `timeoutMs` to `runCommand` (SDK) and a `--timeout <duration>` flag to `sandbox exec` (CLI). When the duration elapses the command is killed with SIGKILL (commands typically surface as exit code 137). Cannot be combined with `detached: true` (SDK) or `--interactive` (CLI).
