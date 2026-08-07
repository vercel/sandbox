# Contributing

## Formatting

JavaScript and TypeScript are formatted with [oxfmt](https://oxc.rs/docs/guide/usage/formatter),
configured in [`.oxfmtrc.json`](./.oxfmtrc.json). JSON and Markdown are still
formatted with Prettier.

- `pnpm run format` formats every JS/TS file in the repo.
- `pnpm run format:check` reports files that are not formatted. CI runs this on
  every pull request, so unformatted code fails the build.

A `pre-commit` hook runs oxfmt over staged JS/TS files, so in practice you
rarely need to run either command by hand.

## Running the tests

NOTE: Running the tests creates actual sandboxes.

1. [Install direnv](https://direnv.net/docs/installation.html)
2. [Hook direnv into your shell](https://direnv.net/docs/hook.html)
3. `vc link` to a project that you want to use for experimentation.
4. `vc env pull` so you get an `.env.local` with a `VERCEL_OIDC_TOKEN`
5. `cd packages/sandbox && pnpm test`

## Sandbox images

The Dockerfiles for the `vercel/sandbox/*` images live in
[`images/`](./images). See the [images README](./images/README.md) for the
full list of images and how to build them.
