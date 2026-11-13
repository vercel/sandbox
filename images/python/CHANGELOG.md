# sandbox-image-python

## 0.2.0

### Minor Changes

- Add a Python 3.15 Vercel Managed Image with pip, venv, uv, and uvx, publishing both `3.15` and `3.15.0` tags. Share a single source-build Dockerfile parameterized by `PYTHON_VERSION` with the Python 3.14 image, now pinned to CPython 3.14.8. Preserve the Ubuntu image's runtime data, Berkeley DB support, loadable SQLite extensions (`Connection.enable_load_extension()` and `Connection.load_extension()`), and Python packaging tools while excluding CPython's test modules. ([#418](https://github.com/vercel/sandbox/pull/418))

### Patch Changes

- Pin image inputs in `docker-bake.hcl`: base images by digest, tools by exact version, and Ubuntu packages by an Ubuntu archive snapshot. ([#454](https://github.com/vercel/sandbox/pull/454))

- Restore repository-pinned SHA-256 verification for Python source builds, rejecting missing or mismatched checksums before extraction. ([#418](https://github.com/vercel/sandbox/pull/418))

- Refresh the Ubuntu snapshot for GNU C Library security fixes. Update uv, GitHub ([#471](https://github.com/vercel/sandbox/pull/471))
  CLI, Claude Code, Codex, and fx to their latest stable releases in the pinned
  major lines. Python versions remain unchanged.

## 0.1.1

### Patch Changes

- Add `curl` to the `node` and `python` images so common install scripts and HTTP calls work without installing it first. ([#463](https://github.com/vercel/sandbox/pull/463))

## 0.1.0

### Minor Changes

- Initial release of the `vercel/sandbox/*` images: `ubuntu` (base), `node` (22/24/26), `python` (3.14 with Git), `universal` (Node.js, Python, coding agents and utilities) and `arch` (with yay/AUR support). ([#276](https://github.com/vercel/sandbox/pull/276))
