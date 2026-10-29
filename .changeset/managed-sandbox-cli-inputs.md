---
"sandbox": minor
"@vercel/sandbox": patch
"@vercel/sandbox-mock": patch
---

Add experimental managed Git and GitHub credential inputs to sandbox creation,
including `--commit-as-me` to use the global Git identity.
Use repeated options for one permission group or --managed-credentials-file
for multiple groups. Accept GitHub usernames or IDs for API identities. Carry
the current API fields through the SDK, validate inputs,
require consent for managed access, and reject creation inputs when resuming an
existing sandbox. Do not automatically retry sandbox creation.
