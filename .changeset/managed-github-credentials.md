---
"@vercel/sandbox": minor
---

Support Vercel-managed Git and GitHub API credential requests when creating a Sandbox. Named `getOrCreate` calls reject these create-only requests instead of returning an existing Sandbox with unknown authority.
