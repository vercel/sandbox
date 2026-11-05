---
"sandbox": patch
"@vercel/sandbox": patch
"@vercel/sandbox-mock": patch
---

Git and GitHub API permissions now share `credentials.github` action groups. Explicit action flags preserve the complete requested set without implicit Git write. The selected GitHub actor supplies commit attribution instead of inferred local Git metadata. Requests no longer send `source.credentials`, and reviews, configuration replay, SDK types, and mock exports follow the unified contract.
