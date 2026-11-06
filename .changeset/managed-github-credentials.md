---
"sandbox": minor
"@vercel/sandbox": minor
"@vercel/sandbox-mock": patch
---

Add experimental managed GitHub credentials to `create`, `run`, and `sh`.
Infer repository and actor from Git, `gh`, or Vercel, with explicit flag overrides.
Reuse existing scope selection, not `vercel switch`, and never copy a raw GitHub token.

Use unified API-shaped actions and JSON for configuration input/export and
read-only Sandbox reuse. Reuse requires nonsecret request metadata and fresh
consent. Git attribution comes from `actAs`; deprecated `commitAs` is rejected.
The SDK adds managed-credential request types and optional nonsecret session metadata.

Show the two-column `Inferred Parameters` preview with `Repo`, one action per
line, and a heading separator. `--yes` grants consent without review. Agents,
CI, and piped/non-terminal sessions are detected without `--non-interactive`.
Read project Bounds through one backend-resolved, paginated endpoint. Missing
Bounds require a warning and second consent; unreadable policy stops creation.

Rejection prints direct flags only for eligible non-file configurations, with
matching usernames preferred and token values replaced by a required placeholder.
It creates no file and prints no JSON/shell recovery. Other options need re-adding.
Export occurs after creation. Missing values and lookup failures use safe errors.
SDK creation is not retried; inspect uncertain outcomes before retrying manually.

Remove unused helpers, action exports, return values, validation/cache bookkeeping,
and duplicate test setup. Display-name reads remain in the CLI, not SDK auth.
See the managed-credentials guide for the full contract, safety rules, and examples.
