---
"@vercel/sandbox": minor
---

Add opt-in stdin for commands. Pass `stdin: true` to a detached `runCommand`, then use `command.writeStdin(data)` and `command.closeStdin()` while it runs, or pass a `Readable` such as `process.stdin` to have it piped to the command.
