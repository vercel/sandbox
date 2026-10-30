---
"@vercel/sandbox": minor
"@vercel/sandbox-mock": patch
---

Support read-only managed Git clones. A Git `source` now accepts
`credentials: true` for managed Git write access or `credentials: "read"` for a
read-only clone, so read-only repository access can be requested through the
normal creation path instead of requiring a deferred grant. Export
`MANAGED_GIT_ACTIONS` alongside `GITHUB_API_CREDENTIAL_ACTIONS`, plus the
`ManagedGitAction` and `ManagedSourceCredentials` types, and read back the
managed-credential request the API reports for an existing Sandbox so an
equivalent configuration can be rebuilt without copying tokens, grant IDs, or
attestations.
