---
"@vercel/sandbox": minor
---

Add `response` to network policy rules, so a rule can be answered by the sandbox proxy instead of being sent to the destination. A trailing `response` rule with no `match` answers whatever the earlier rules did not claim, which restricts an allowed domain to specific paths without running your own proxy.
