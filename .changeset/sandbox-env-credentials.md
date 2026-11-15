---
"@vercel/sandbox": minor
"sandbox": minor
---

Read `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and `VERCEL_PROJECT_ID` from the environment when `VERCEL_OIDC_TOKEN` is unavailable, so access tokens from CI work without passing credentials. The `sandbox` CLI also accepts `VERCEL_TOKEN` after `VERCEL_AUTH_TOKEN` and `VERCEL_OIDC_TOKEN`, uses `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID` when it can't infer the scope from the token, and fails instead of starting a browser log in when `CI` is set.
