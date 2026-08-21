# runtime-node

`vercel/sandbox/runtime-node:22` | `vercel/sandbox/runtime-node:24` | `vercel/sandbox/runtime-node:26`

Node.js on top of the [runtime-base](../runtime-base) image. Each tag pins a
major version, with the exact release supplied to the build through
`NODE_VERSION`.

Runs as the `vercel-sandbox` user (uid 1000) with passwordless sudo.

## Packages

- Node.js 22.22.2, 24.14.1, or 26.1.0 (depending on the image tag)
- `npm` and `npx`
- `pnpm` 10
- Git 2.49.0
