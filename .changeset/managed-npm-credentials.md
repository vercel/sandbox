---
"sandbox": minor
"@vercel/sandbox": minor
---

Add `credentials: { npm: true }` to `Sandbox.create` and `--credentials=npm` to `create`, `run`, and `sh`, so a sandbox can install your team's private npm packages with Vercel managed credentials injected into the sandbox network policy. After creating, the CLI lists the npm registries the sandbox got, or warns when the team has no npm credentials. `--credentials` takes a comma-separated list, so later credential types share the same flag.
