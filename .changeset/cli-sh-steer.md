---
"sandbox": patch
---

`sandbox sh <command>` now explains that `sh` takes no command and points at `sandbox run -i <command>`, noting that the sandbox persists after the command exits and that `--rm` removes it automatically.
