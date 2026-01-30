---
"sandbox": minor
---

- `sandbox ssh <sandbox_id>` is now `sandbox connect <sandbox_id>`. Aliases are: `shell`, `ssh` for backward compact
- `sandbox sh` is now `sandbox create --connect`

If the user runs `sandbox sh ...`, we also try to remap automatically to `sandbox create --connect` and print a warning
