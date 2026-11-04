# Vercel Managed Images

Dockerfiles for Vercel Managed Images published to Vercel Container Registry (VCR) under
`vercel/sandbox/*`.

| Image                                            | Base                    | Contents                                                  |
| ------------------------------------------------ | ----------------------- | --------------------------------------------------------- |
| [`vercel/sandbox/universal:latest`](./universal) | `vercel/sandbox/ubuntu` | Node.js LTS (24), Python (3.14), coding agents, utilities |
| [`vercel/sandbox/node:22\|24\|26`](./node)       | `vercel/sandbox/ubuntu` | Node.js (major pinned), pnpm                              |
| [`vercel/sandbox/python:3.14\|3.15`](./python)   | `vercel/sandbox/ubuntu` | Python (source build), pip, venv, uv                      |
| [`vercel/sandbox/arch:latest`](./arch)           | `archlinux:latest`      | Arch Linux, yay (AUR), base-devel, git                    |
| [`vercel/sandbox/ubuntu:latest`](./ubuntu)       | `ubuntu:26.04`          | Ubuntu + sudo                                             |
| [`vercel/sandbox/node:al-22\|24\|26`](./al-node) | `al-base`               | Node.js (major pinned), pnpm                              |
| [`vercel/sandbox/python:al-3.13.1`](./al-python) | `al-base`               | Python 3.13.1, pip, venv, uv                              |

All images are built for `linux/amd64`.

## Building locally

```sh
cd images

# Build all images
docker buildx bake

# Build a single image
docker buildx bake node-24
docker buildx bake universal
docker buildx bake python
docker buildx bake python-315
```

Both Python versions use the same Dockerfile. To build another release, override
`PYTHON_VERSION` with a full CPython version and set a matching local tag:

```sh
docker buildx bake python --set python.args.PYTHON_VERSION=3.15.0 --set python.tags=python-local:3.15.0
```

The default and `vmi` groups build both Python versions. To add a release, configure
its version and tags in `docker-bake.hcl`.
