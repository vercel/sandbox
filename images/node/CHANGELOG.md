# sandbox-image-node

## 0.1.3

### Patch Changes

- Add `curl` to the `node` and `python` images so common install scripts and HTTP calls work without installing it first. ([#463](https://github.com/vercel/sandbox/pull/463))

- Update Node.js images to the November 2026 security releases. ([#468](https://github.com/vercel/sandbox/pull/468))

## 0.1.2

### Patch Changes

- Update Node.js 22, 24, and 26 images to the latest security releases. Pin Node.js 24 in the universal image so builds use the patched release. ([#399](https://github.com/vercel/sandbox/pull/399))

## 0.1.1

### Patch Changes

- Pin exact Node.js versions during builds and publish exact-version image tags alongside the major-version tags. ([#279](https://github.com/vercel/sandbox/pull/279))

## 0.1.0

### Minor Changes

- Initial release of the `vercel/sandbox/*` images: `ubuntu` (base), `node` (22/24/26), `python` (3.14 with Git), `universal` (Node.js, Python, coding agents and utilities) and `arch` (with yay/AUR support). ([#276](https://github.com/vercel/sandbox/pull/276))
