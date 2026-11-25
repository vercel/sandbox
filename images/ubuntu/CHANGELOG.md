# sandbox-image-ubuntu

## 0.2.0

### Minor Changes

- Publish each image for `linux/arm64` as well as `linux/amd64`, under the same tags. ([#491](https://github.com/vercel/sandbox/pull/491))

### Patch Changes

- Refresh managed image snapshots, base images, Python runtimes, package managers, ([#481](https://github.com/vercel/sandbox/pull/481))
  and coding agents within their existing release lines, including security fixes.

## 0.1.1

### Patch Changes

- Pin image inputs in `docker-bake.hcl`: base images by digest, tools by exact version, and Ubuntu packages by an Ubuntu archive snapshot. ([#454](https://github.com/vercel/sandbox/pull/454))

- Refresh the Ubuntu base image digest and snapshot to 20261116T060000Z. Update ([#477](https://github.com/vercel/sandbox/pull/477))
  pnpm to 11.28.12, Claude Code to 2.1.325, Codex to 0.169.0, and fx to 0.0.17.
  Include pnpm registry hardening and bundled dependency cleanup (attributed to
  CVE-2026-84947 by pnpm's release notes), Claude Code response-decoding and
  permission hardening, Codex project-trust protections, and fx terminal and
  credential hardening. Keep Python versions unchanged.

- Refresh the Ubuntu snapshot for GNU C Library security fixes. Update uv, GitHub ([#471](https://github.com/vercel/sandbox/pull/471))
  CLI, Claude Code, Codex, and fx to their latest stable releases in the pinned
  major lines. Python versions remain unchanged.

## 0.1.0

### Minor Changes

- Initial release of the `vercel/sandbox/*` images: `ubuntu` (base), `node` (22/24/26), `python` (3.14 with Git), `universal` (Node.js, Python, coding agents and utilities) and `arch` (with yay/AUR support). ([#276](https://github.com/vercel/sandbox/pull/276))
