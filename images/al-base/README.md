# al-base

`vercel/sandbox/al-base:latest`

The Amazon Linux 2023 base image for the runtime image family. It includes a
compiled Git 2.49.0 installation and common runtime utilities.

Runs as the `vercel-sandbox` user (uid 1000) with passwordless sudo.

## Packages

- Git 2.49.0
- Common network, archive, process and image libraries
- `sudo`
- Legacy iptables
