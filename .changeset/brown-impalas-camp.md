---
"@vercel/sandbox": patch
"sandbox": patch
---

Add multi-region support for drives:

- Set the `region` field when creating a new drive, or use the `--region` flag in the CLI.
- You can retrieve the region of a drive using the `region` getter on the `Drive` class.
- Drives can be only be mounted to sandboxes running on the same region.
