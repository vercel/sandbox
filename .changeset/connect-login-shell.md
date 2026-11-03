---
"sandbox": patch
---

Use the login shell of the user for interactive sessions when `SHELL` is not set. Before, images without `SHELL` started `sh`, and on Debian-based images `sh` has no line editing.
