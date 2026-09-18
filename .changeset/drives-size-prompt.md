---
"sandbox": minor
---

`sandbox drives get-or-create` now asks for the size limit when run interactively without `--max-size`, and `--max-size` accepts sizes with units (`200GiB`, `2TiB`) as well as bytes. Input that does not parse is rejected instead of being truncated. Scripts, CI and AI agents are never prompted: the question only appears when stdin and stderr are terminals, `CI` is unset, no agent is detected, and the drive does not already exist.
