---
"@vercel/sandbox": minor
"@vercel/sandbox-mock": minor
"sandbox": patch
---

`Sandbox.region` and `Sandbox.failoverRegions` no longer return `undefined`: the getters now report the platform defaults (`iad1` and `[]`) when the API omits the fields, so their types are `string` and `string[]`. The new `DEFAULT_SANDBOX_REGION` export makes the default region readable.
