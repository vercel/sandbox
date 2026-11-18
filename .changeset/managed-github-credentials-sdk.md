---
"@vercel/sandbox": minor
"@vercel/sandbox-mock": minor
---

Add experimental `credentials: { github: [...] }` to `Sandbox.create`, so a sandbox can use Git and the GitHub API on your repositories with Vercel managed credentials and no GitHub token inside the sandbox. Each entry lists its `repositories`, the `actions` allowed on them, and an optional `actAs` GitHub account. The SDK exports `SANDBOX_GITHUB_CREDENTIAL_ACTIONS`, the list of supported actions, and `@vercel/sandbox-mock` re-exports it.
