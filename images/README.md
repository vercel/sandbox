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
| [`vercel/sandbox/node:al-22\|24\|26`](./al-node) | `al-base`               | Node.js (major pinned), pnpm                              |
| [`vercel/sandbox/python:al-3.13.1`](./al-python) | `al-base`               | Python 3.13.1, pip, venv, uv                              |

All images are built for `linux/amd64`.

## Pinned versions

Base images and tools are pinned in [`docker-bake.hcl`](./docker-bake.hcl). To change what an
image contains, change the value there.

| Input                                                          | Pinned by                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Base images (`ubuntu`, `archlinux`, `amazonlinux`, `oven/bun`) | Versioned tag and digest                                                       |
| Tools (pnpm, uv, gh, coding agents, Node.js, fx)               | Exact version                                                                  |
| `yay`                                                          | `YAY_BIN_COMMIT`, a commit of the `yay-bin` AUR package                        |
| Ubuntu and Arch packages                                       | Not pinned: each build installs the current updates                            |
| Amazon Linux packages                                          | The `amazonlinux` base image, whose release version locks its package versions |

## Building locally

```sh
cd images

# Build all images
docker buildx bake

# Build a single image
docker buildx bake node-24
docker buildx bake universal
```
