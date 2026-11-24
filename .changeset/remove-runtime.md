---
"@vercel/sandbox": major
"sandbox": major
---

Remove the deprecated `runtime` option from the SDK and the `--runtime` flag from the CLI. Sandboxes are now always created from an image. Sandboxes that set neither `image` nor `source` keep using `vercel/sandbox/universal`.

Replace `runtime` with `image`. Choose an `al-` tag to keep Amazon Linux 2023, or choose the Ubuntu image:

- `node22`: `vercel/sandbox/node:al-22` (Amazon Linux) or `vercel/sandbox/node:22` (Ubuntu).
- `node24`: `vercel/sandbox/node:al-24` (Amazon Linux) or `vercel/sandbox/node:24` (Ubuntu).
- `node26`: `vercel/sandbox/node:al-26` (Amazon Linux) or `vercel/sandbox/node:26` (Ubuntu).
- `python3.13`: `vercel/sandbox/python:al-3.13.1` (Amazon Linux) or `vercel/sandbox/python:3.14` (Ubuntu, upgrades Python to 3.14).

On the CLI, replace `--runtime <runtime>` with `--image <image>` using the same mapping. `sandbox ls` now shows an `IMAGE` column instead of `IMAGE/RUNTIME`, and `sandbox sessions list` no longer shows a `RUNTIME` column.

The `al-` tags support `linux/amd64` only. They run as `vercel-sandbox` and use `dnf` for system packages. Ubuntu images run as `ubuntu` and use `apt-get`. See the [images documentation](https://vercel.com/docs/sandbox/concepts/images) for the full catalog and custom images.
