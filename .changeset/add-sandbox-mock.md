---
"@vercel/sandbox-mock": minor
"@vercel/sandbox": patch
---

Add `@vercel/sandbox-mock`, a drop-in mock for `@vercel/sandbox` backed by `just-bash`. Rather than reimplementing the SDK surface, it runs the real `@vercel/sandbox` classes against an in-memory implementation of the `/v2/sandboxes` HTTP API injected through the SDK's `fetch` seam — so command execution, filesystem, multi-user/group management, snapshots, and forking all exercise the real SDK code. Commands run locally via `just-bash` against an in-memory filesystem, and `command()`/`setupSandbox()` let tests stub the output of commands `just-bash` can't run.

As part of this, `Snapshot.get` now forwards a custom `fetch` (via `WithFetchOptions`), matching `Snapshot.list` and `Snapshot.tree`. Previously it always used the global `fetch`, so an injected client — such as the mock — could not intercept the request.
