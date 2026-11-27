# sandbox-image-al-python

## 1.0.2

### Patch Changes

- Update Git to 2.56.1 in the Amazon Linux images and add the Rust toolchain to the Git build stage. ([#503](https://github.com/vercel/sandbox/pull/503))

- Refresh managed image snapshots, base images, Python runtimes, package managers, ([#481](https://github.com/vercel/sandbox/pull/481))
  and coding agents within their existing release lines, including security fixes.

## 1.0.1

### Patch Changes

- Pin image inputs in `docker-bake.hcl`: base images by digest, tools by exact version, and Ubuntu packages by an Ubuntu archive snapshot. ([#454](https://github.com/vercel/sandbox/pull/454))

- Refresh the Ubuntu snapshot for GNU C Library security fixes. Update uv, GitHub ([#471](https://github.com/vercel/sandbox/pull/471))
  CLI, Claude Code, Codex, and fx to their latest stable releases in the pinned
  major lines. Python versions remain unchanged.

## 1.0.0

### Major Changes

- Open source Amazon Linux legacy runtime images ([#313](https://github.com/vercel/sandbox/pull/313))
