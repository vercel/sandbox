---
"sandbox": minor
---

Add `--credentials-output <FILE>` to `create`, `run`, and `sh` (experimental). After the sandbox is created, the CLI writes its credentials request to the file as JSON, and `--credentials-file` reads it back to create another sandbox with the same request. The file is never overwritten, and the path is checked before the sandbox is created.
