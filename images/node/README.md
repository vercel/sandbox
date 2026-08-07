# node

`vercel/sandbox/node:22` | `vercel/sandbox/node:24` | `vercel/sandbox/node:26`

Node.js on top of the [ubuntu](../ubuntu) base image. Each tag pins a major version
and installs the latest release of that line at build time, so tags roll
forward with rebuilds.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

- Node.js (latest release of the tag's major line), with `npm`, `npx` and
  `corepack`
- `pnpm` 11
- Git
- `libatomic1`
