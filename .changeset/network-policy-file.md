---
"sandbox": minor
"@vercel/sandbox": minor
"@vercel/sandbox-mock": minor
---

Add `--network-policy-file <FILE>` (use `-` for stdin) to `create`, `run`, `sh`, `fork`, and `config network-policy`. It takes the whole network policy as JSON in the SDK's `NetworkPolicy` shape, so the CLI can express any rule the SDK can, such as a request header limited to `GET` and `HEAD`. The SDK exports `parseNetworkPolicy`, which validates untrusted input with the same rules as `Sandbox.create`, rejects unknown keys, and never includes values in its errors. `@vercel/sandbox-mock` re-exports both.
