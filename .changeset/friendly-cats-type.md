---
"@vercel/sandbox": minor
---

Add support for setting file permissions (mode) in the `writeFiles` API. Files can now include an optional `mode` property to set permissions on the tarball, avoiding the need for a separate `chmod` command.

```ts
await sandbox.writeFiles([
  { path: "/usr/local/bin/myscript", content: Buffer.from("#!/bin/bash\necho hello"), mode: 0o755 }
]);
```
