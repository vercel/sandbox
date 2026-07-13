---
"@vercel/sandbox-mock": minor
---

Add `@vercel/sandbox-mock`, a drop-in mock for `@vercel/sandbox` backed by `just-bash`. Brings the mock to parity with the current SDK: multi-user and group management (`createUser`, `asUser`, `createGroup`, `addUserToGroup`, `removeUserFromGroup`, `SandboxUser`, `ExecutionContext`), `Command.durationMs`, and the updated timeout/`expiresAt` semantics. Also fixes detached command handlers so `runCommand({ detached: true })` returns a working `Command`.
