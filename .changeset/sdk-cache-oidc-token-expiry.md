---
"@vercel/sandbox": patch
---

Skip the per-request OIDC token check while the current token is more than 5 minutes from expiring, and share one refresh between concurrent requests.
