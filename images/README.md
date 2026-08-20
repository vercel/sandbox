# Vercel Managed Images

Dockerfiles for Vercel Managed Images published to Vercel Container Registry (VCR) under
`vercel/sandbox/*`.

| Image                                            | Base                    | Contents                                                  |
| ------------------------------------------------ | ----------------------- | --------------------------------------------------------- |
| [`vercel/sandbox/universal:latest`](./universal) | `vercel/sandbox/ubuntu` | Node.js LTS (24), Python (3.14), coding agents, utilities |
| [`vercel/sandbox/node:22\|24\|26`](./node)       | `vercel/sandbox/ubuntu` | Node.js (major pinned), pnpm                              |
| [`vercel/sandbox/python:3.14`](./python)         | `vercel/sandbox/ubuntu` | Python 3.14 (pinned), pip, venv, uv                       |
| [`vercel/sandbox/arch:latest`](./arch)           | `archlinux:latest`      | Arch Linux, yay (AUR), base-devel, git                    |
| [`vercel/sandbox/ubuntu:latest`](./ubuntu)       | `ubuntu:26.04`          | Ubuntu + sudo                                             |
| [`vercel/sandbox/runtime-base:latest`](./runtime-base) | `amazonlinux:2023` | Amazon Linux runtime base, Git 2.49.0, sudo               |
| [`vercel/sandbox/runtime-node:22\|24\|26`](./runtime-node) | `runtime-base` | Node.js runtime (major pinned), pnpm                      |
| [`vercel/sandbox/runtime-python:3.13.1`](./runtime-python) | `runtime-base` | Python 3.13.1, pip, venv, uv                              |

All images are built for `linux/amd64`.

## Building locally

```sh
cd images

# Build all images
docker buildx bake

# Build a single image
docker buildx bake node-24
docker buildx bake universal
```
