---
"@vercel/sandbox": minor
---

Add opt-in stdin for detached commands. Pass `stdin: true` to `runCommand`, then use `command.writeStdin(data)` and `command.closeStdin()` while it runs.
