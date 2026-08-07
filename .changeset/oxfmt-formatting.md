---
"@vercel/sandbox-mock": patch
"@vercel/sandbox": patch
"sandbox": patch
---

Replace Prettier with [oxfmt](https://oxc.rs/docs/guide/usage/formatter) as the repo's only formatter, and enforce `pnpm run format:check` in CI so pull requests no longer carry whitespace-only churn. No runtime behaviour changes.
