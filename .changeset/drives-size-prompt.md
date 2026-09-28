---
"sandbox": minor
---

`sandbox drives get-or-create --max-size` now accepts sizes with units (`200GiB`, `2TiB`) as well as raw bytes, and rejects input it cannot parse instead of truncating it, so `2TiB` is no longer read as 2 bytes. When `--max-size` is omitted, the printed size says where it came from: `max size: 1 TiB (set with --max-size at creation, fixed afterwards)`.
