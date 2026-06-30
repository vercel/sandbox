---
"sandbox": patch
---

Fix the interactive shell prompt so that it is built from POSIX-portable primitives — it renders correctly regardless of which shell (`bash`, `dash`, busybox `ash`) a custom image ships as `/bin/sh`.
