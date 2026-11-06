# ubuntu

`vercel/sandbox/ubuntu:latest`

The Ubuntu 26.04 base for all Ubuntu-based sandbox images. Git 2.56.0 is built
from the kernel.org source archive, verified with SHA-256, and installed in
`/opt/git`. Its `bin` directory leads the base `PATH` and is inherited by the
Node.js, Python, and universal images.

Bake supplies `GIT_VERSION` and `GIT_SHA256`; neither has a Dockerfile default.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

- Git 2.56.0 (shared source-built pin)
- `ca-certificates`, `openssh-client`, `sudo`
- Git runtime dependencies: `libcurl4t64`, `libexpat1`, `libssl3t64`, `perl`, `zlib1g`
