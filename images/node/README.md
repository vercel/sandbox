# node

`vercel/sandbox/node:22` | `vercel/sandbox/node:24` | `vercel/sandbox/node:26`

Node.js on top of the [ubuntu](../ubuntu) base image. Each tag pins a major version,
with the exact release supplied to the build through `NODE_VERSION`.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

- Node.js 22.23.2, 24.19.0, or 26.7.0 (depending on the image tag), with
  `npm`, `npx` and `corepack`
- `pnpm` 11
- `git`
- `libatomic1`
