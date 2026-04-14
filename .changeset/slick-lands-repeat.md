---
"@vercel/sandbox": patch
"sandbox": patch
---

Smarter fallback team selection for scope inference: tries `defaultTeamId` first, then the best hobby-plan OWNER team (personal team or most recently updated). Filters fallback candidates by `billing.plan === 'hobby'` to avoid selecting pro/enterprise teams. Skips teams that return 403 and shows a helpful error when no team allows sandbox creation.
