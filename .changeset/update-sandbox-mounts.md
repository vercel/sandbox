---
"@vercel/sandbox": patch
"@vercel/sandbox-mock": patch
"sandbox": patch
---

Allow updating the drives mounted on a sandbox:

- New `mounts` option on `Sandbox.update()`. It replaces all existing mounts and applies to the next session. Pass an empty object to remove all mounts.
- New `sandbox config mounts <name> --mount drive:/path[:mode]` CLI command. Omit `--mount` to remove all mounts.
- `sandbox config list` now shows the mounts.
