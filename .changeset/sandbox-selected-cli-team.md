---
"sandbox": patch
"@vercel/sandbox": patch
---

Sandbox CLI now uses the team selected with `vercel switch` before the account default. Explicit flags, OIDC claims, and linked projects retain their priority. Team IDs resolve to readable names when available, and failed lookups do not select another team.
