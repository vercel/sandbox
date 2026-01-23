# Contributing

## Running the tests

NOTE: Running the tests creates actual sandboxes.

1. [Install direnv](https://direnv.net/docs/installation.html)
2. [Hook direnv into your shell](https://direnv.net/docs/hook.html)
3. `vc link` to a project that you want to use for experimentation.
4. `vc env pull` so you get an `.env.local` with a `VERCEL_OIDC_TOKEN`
5. `cd packages/sandbox && pnpm test`
