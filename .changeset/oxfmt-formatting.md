---
"@vercel/sandbox-mock": patch
"@vercel/sandbox": patch
"sandbox": patch
---

Format all JavaScript and TypeScript sources with [oxfmt](https://oxc.rs/docs/guide/usage/formatter) and enforce `pnpm run format:check` in CI, so pull requests no longer carry whitespace-only churn. No runtime behaviour changes.
