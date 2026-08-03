# ubuntu

`vercel/sandbox/ubuntu:latest`

The base image for all Ubuntu-based sandbox images: contains only Ubuntu and
no additional tooling. Tracks the latest Ubuntu LTS (currently 26.04) and
rolls forward to newer releases when they become available.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

- `ca-certificates`
- `sudo`
