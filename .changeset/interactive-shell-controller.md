---
"@vercel/sandbox": minor
"sandbox": minor
---

Move the interactive shell server out of the sandbox and into the sandbox-controller. `sandbox connect`/`ssh` (CLI) and the new `Sandbox.openInteractive()` (SDK) now request a WebSocket URL and token from the API and connect to the controller-hosted PTY, instead of installing and bootstrapping the `vc-interactive-server` binary inside the sandbox at connect time. This removes the bundled server binary along with the `@vercel/pty-tunnel` and `@vercel/pty-tunnel-server` packages.
