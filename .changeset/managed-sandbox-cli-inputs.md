---
"sandbox": minor
"@vercel/sandbox": patch
---

Add experimental managed Git and GitHub credential inputs to sandbox creation,
including `--commit-as-me` to use the global Git identity.
Use repeated options for one permission group or an explicit JSON file for
multiple groups. Carry the current API fields through the SDK, validate inputs,
require consent for managed access, and reject creation inputs when resuming an
existing sandbox. Do not automatically retry sandbox creation.
