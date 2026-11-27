---
"@vercel/sandbox": patch
---

`SandboxUser` now rejects relative paths that resolve outside the user's home directory. `writeFiles`, `mkDir`, `readFile`, `readFileToBuffer`, and `downloadFile` throw for a relative path such as `../outside.txt` instead of reaching a location outside the home directory. Absolute paths and an explicit `cwd` keep their current behavior.
