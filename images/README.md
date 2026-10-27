# Vercel Managed Images

Dockerfiles for Vercel Managed Images published to Vercel Container Registry (VCR) under
`vercel/sandbox/*`.

| Image                                                  | Base                    | Contents                                           |
| ------------------------------------------------------ | ----------------------- | -------------------------------------------------- |
| [`vercel/sandbox/universal:latest`](./universal)       | `vercel/sandbox/python` | Node.js LTS (24), Python, coding agents, utilities |
| [`vercel/sandbox/node:22\|24\|26`](./node)             | `vercel/sandbox/ubuntu` | Node.js (exact version per major), pnpm            |
| [`vercel/sandbox/python:3.14\|3.14.10`](./python)      | `vercel/sandbox/ubuntu` | Python, pip, venv, uv                              |
| [`vercel/sandbox/arch:latest`](./arch)                 | `archlinux:latest`      | Arch Linux, yay (AUR helper), base-devel, Git      |
| [`vercel/sandbox/ubuntu:latest`](./ubuntu)             | `ubuntu:26.04`          | Ubuntu, source-built Git, sudo                     |
| [`vercel/sandbox/node:al-22\|al-24\|al-26`](./al-node) | `al-base`               | Node.js (exact version per major), pnpm            |
| [`vercel/sandbox/python:al-3.13.1`](./al-python)       | `al-base`               | Python, pip, venv, uv                              |

All images are built for `linux/amd64`.

## Shared tool versions

[`docker-bake.hcl`](./docker-bake.hcl) is the single source of truth for explicitly
pinned tool versions in the maintained VMIs (`ubuntu`, `node`, `python`,
`universal`, and `arch`). Its shared `_versioned` arguments keep each tool on the
same version wherever it is installed; Dockerfiles consume these arguments
without local version defaults. Refer to Bake for numeric pins rather than
maintaining a second version list here.

Legacy `al-*` images are excluded: their Dockerfiles, versions, and Bake targets
remain unchanged and do not inherit the shared tool arguments.

| Tool        | Bake variable                     |
| ----------- | --------------------------------- |
| Node.js     | `NODE_VERSIONS`, `NODE_LTS_MAJOR` |
| Python      | `PYTHON_VERSION`                  |
| pip         | `PIP_VERSION`                     |
| uv          | `UV_VERSION`                      |
| pnpm        | `PNPM_VERSION`                    |
| Bun         | `BUN_VERSION`                     |
| Git         | `GIT_VERSION`                     |
| Git LFS     | `GIT_LFS_VERSION`                 |
| GitHub CLI  | `GH_VERSION`                      |
| Claude Code | `CLAUDE_CODE_VERSION`             |
| Codex       | `CODEX_VERSION`                   |
| opencode    | `OPENCODE_VERSION`                |
| pi          | `PI_VERSION`                      |
| fx          | `FX_VERSION`                      |
| yay         | `YAY_VERSION`                     |

Node.js intentionally uses a major-to-exact-version map: the Ubuntu-based Node
images publish multiple supported majors, while Universal selects the entry
identified by `NODE_LTS_MAJOR`. This is not a separate Universal version pin.
Tools bundled with Node.js, such as npm, follow the selected Node.js distribution.

The Ubuntu-based Python image builds from a verified upstream source archive;
Universal inherits that Python image. Git is built from the same verified
upstream source in Ubuntu and Arch, and inherited by their derived images.
Update pinned archive checksums (`PYTHON_SHA256`, `GIT_SHA256`,
`GIT_LFS_SHA256`, `GH_SHA256`, `YAY_SHA256`) together with their versions; fx verifies
the checksum supplied with its selected release.

OS packages and libraries installed through `apt`, `dnf`, and `pacman` remain
rolling within their distributions so builds can receive security updates. These
top-level tool pins do not freeze OS/base-image contents or transitive package
dependencies and do not make the entire image build fully reproducible.

## Checking version configuration

```sh
# From the repository root; requires Docker Buildx, but no running daemon.
python3 -m unittest discover -s images -p 'test_*.py'
```

These checks also run in the image build workflow. Dockerfile smoke checks verify
the installed tool versions during builds.

## Building locally

```sh
cd images

# Build all images
docker buildx bake

# Build a single image
docker buildx bake node-24
docker buildx bake universal
```
