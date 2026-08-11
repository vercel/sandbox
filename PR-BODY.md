# Add `--ai` flag to inject AI Gateway credentials into sandboxes

## What

`sandbox create --ai` (and `sh`, `run`, `exec`, `connect`/`ssh`) exposes AI Gateway credentials inside the sandbox so coding agents work with zero configuration:

```
$ sandbox sh --ai
▲ /vercel/ claude        # no login, no API keys
```

The CLI obtains a short-lived OIDC token scoped to the sandbox's own team and project (reusing the CLI's token when it is already an OIDC JWT, otherwise minting one via `/v3/env/pull/:projectId`) and injects three variables:

- `AI_GATEWAY_API_KEY`: the gateway's own credential variable, checked first by the AI SDK and read by tools with a built-in gateway provider (opencode's `vercel/*` model catalog activates on it); only ever sent to the gateway
- `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`: point Anthropic clients (Claude Code) at the gateway's Anthropic-compatible endpoint, which accepts the OIDC token as a Bearer credential

`VERCEL_OIDC_TOKEN` is deliberately not injected: the create API caps the `env` payload at 4096 bytes, OIDC tokens run ~1.3KB, and a third copy of the token overflows the limit. Its AI SDK role is covered by `AI_GATEWAY_API_KEY`, which the AI SDK checks with higher precedence.

## Why

The universal image preinstalls `claude`, `codex`, and `opencode`, but they boot with no credentials, so the first-run experience is a login screen (see the managed-images launch thread in #review-socials). Since the CLI is always authenticated by the time a sandbox exists, it can hand the agent a credential without asking the user for anything.

## Design notes

- **Injection happens in two places** because they reach different consumers: the sandbox default env (covers `runCommand`/`exec`) and the interactive session env (interactive sessions do not receive default env vars).
- **Explicit `--env` values win** over the injected credentials.
- **Token and compute stay coherent**: the token is minted for the exact team/project the sandbox is created in, so AI usage and sandbox usage bill to the same place.
- **Mint is memoized** per team/project, so composite commands (`run` = create + exec) mint once.
- **Token lifetime is ~12h.** Sessions that outlive it will start getting 401s from the gateway; automatic refresh (e.g. piggybacking `extendSandboxTimeoutPeriodically` plus a credential-helper file) is left as a follow-up.
- **`fork --connect` passes `ai: false`** for now: forks inherit env from the source snapshot, and a design for refreshing an inherited stale token is the same follow-up as above.
- **Agent coverage in the universal image** (all live-tested): `claude` works fully out of the box. `opencode` reaches the gateway through the injected `AI_GATEWAY_API_KEY` when a `vercel/*` model is selected (`-m vercel/anthropic/claude-haiku-4.5` verified); without a model selection it silently falls back to its own free provider (it does not read `VERCEL_OIDC_TOKEN`; verified 0 `vercel/*` models with only that set), so a default-model config in the image is needed for it to route through the gateway by default. `codex` ignores `OPENAI_BASE_URL` and needs a `model_providers` block in its config file; `pi` reads `ANTHROPIC_AUTH_TOKEN` but ignores `ANTHROPIC_BASE_URL` (401s against api.anthropic.com). All three config shims belong in the image (follow-up), not in env injection.
- Deliberately NOT setting `OPENAI_API_KEY` to the OIDC token, since tools that talk to api.openai.com directly would leak the token to a third party. `AI_GATEWAY_API_KEY` has no such risk: nothing sends it anywhere but the gateway.

## Verification

- 7 new unit tests (`ai-gateway-env.test.ts`); full CLI package suite passes (69 tests).
- Live end-to-end on two teams (personal Pro team via minted token from a stored user token, and vercel-internal-playground via OIDC reuse):
  - `create --ai` then `exec printenv`: all 3 variables present in command env.
  - `ssh --ai` PTY session: all 3 variables present in session env, and `claude -p` returned a completion through `ai-gateway.vercel.sh` with no other credentials on the machine or in the sandbox.
  - Explicit `--env ANTHROPIC_BASE_URL=x` override confirmed to win over the injected value.
