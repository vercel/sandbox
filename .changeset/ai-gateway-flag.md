---
"sandbox": minor
---

Add an `--ai` flag to `create`, `sh`, `run`, `exec`, and `connect` that exposes AI Gateway credentials inside the sandbox. The CLI issues a short-lived OIDC token scoped to the sandbox's own team and project and injects `AI_GATEWAY_API_KEY`, `ANTHROPIC_BASE_URL`, and `ANTHROPIC_AUTH_TOKEN` into the sandbox's default env and into interactive sessions, so coding agents like Claude Code and AI SDK apps work with zero configuration and no API keys.
