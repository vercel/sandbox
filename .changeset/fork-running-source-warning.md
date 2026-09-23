---
"sandbox": patch
---

`sandbox fork` now looks up the source before forking and warns on stderr when it is running. A fork starts from the source's latest snapshot (or a fresh copy of its runtime when it has none), never from the live filesystem, so anything written in a running source since its last snapshot is left behind while the command still exits 0. The warning points at `sandbox snapshot --stop <source>` as the way to fork the current state, and `fork --help` now says the same.
