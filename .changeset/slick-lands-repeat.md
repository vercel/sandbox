---
"@vercel/sandbox": patch
---

Smarter fallback team selection for scope inference: tries `defaultTeamId` first, then the best OWNER team (personal team or most recently updated). Skips teams that return 403 and shows a helpful error when no team allows sandbox creation.
