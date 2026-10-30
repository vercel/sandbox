# al-node

`vercel/sandbox/node:al-22` | `vercel/sandbox/node:al-24` | `vercel/sandbox/node:al-26`

Node.js on top of the [al-base](../al-base) image. Each tag pins a
major version, with the exact release supplied to the build through
`NODE_VERSION`.

Runs as the `vercel-sandbox` user (uid 1000) with passwordless sudo.

## Packages

- Node.js 22.23.4, 24.22.1, or 26.12.1 (depending on the image tag)
- `npm` and `npx`
- `pnpm` 10
- Git 2.49.0
