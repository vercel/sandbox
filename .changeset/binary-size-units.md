---
"sandbox": patch
---

Label sizes with binary units (KiB, MiB, GiB, TiB) instead of KB/MB/GB/TB. The CLI already divided by 1024, so a 1 TiB drive printed as `1 TB`; drive, snapshot and network-transfer sizes now match the units used in the docs.
