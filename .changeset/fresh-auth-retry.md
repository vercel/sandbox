---
"sandbox": patch
---

Fix transient 401 on the first sandbox command after auto-login by retrying the command when the token was just obtained, to absorb cross-region auth token replication lag.
