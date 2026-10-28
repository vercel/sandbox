---
"sandbox": patch
---

Fix `createApp()` for CLIs that embed the Sandbox CLI, such as `vercel sandbox`. Since 4.10.0, loading a command also started the standalone CLI, which parsed the host's `process.argv`, failed with `Not a valid subcommand name`, and exited the host process with code 1.
