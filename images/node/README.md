# node

`vercel/sandbox/node:22` | `vercel/sandbox/node:24` | `vercel/sandbox/node:26`

Node.js on top of the [ubuntu](../ubuntu) base image. Each tag pins a major version,
with the exact release supplied by Bake through `NODE_VERSION`. Bake also supplies
`PNPM_VERSION` (12.15.0); version arguments have no Dockerfile defaults. The build
checks the installed pnpm version exactly.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

- Node.js 22.23.4, 24.22.1, or 26.12.1 (depending on the image tag), with
  `npm`, `npx` and `corepack`
- `pnpm` 12.15.0
- Git 2.56.0 (inherited from the Ubuntu base via `/opt/git/bin`)
- `libatomic1`
