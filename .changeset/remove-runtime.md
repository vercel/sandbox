---
"@vercel/sandbox": major
"sandbox": major
---

Remove the deprecated `runtime` option from the SDK and the `--runtime` flag from the CLI. Sandboxes are now always created from an image through the v3 API, and `Sandbox.runtime`, `Session.runtime`, and the `RUNTIMES` type are removed. Sandboxes that set neither `image` nor `source` keep using `vercel/sandbox/universal`.

Migrate each `runtime` to the equivalent [Vercel Managed Image](https://vercel.com/docs/sandbox/concepts/images#vercel-managed-images):

- `runtime: "node22"`: use `image: "vercel/sandbox/node:22"`.
- `runtime: "node24"`: use `image: "vercel/sandbox/node:24"`.
- `runtime: "node26"`: use `image: "vercel/sandbox/node:26"`.
- `runtime: "python3.13"`: use `image: "vercel/sandbox/python:3.14"`, and note the Python version upgrade.

On the CLI, replace `--runtime <runtime>` with `--image <image>` using the same mapping. `sandbox ls` now shows an `IMAGE` column instead of `IMAGE/RUNTIME`, and `sandbox sessions list` no longer shows a `RUNTIME` column.

Managed images are based on Ubuntu rather than Amazon Linux 2023, and run as the `ubuntu` user rather than `vercel-sandbox`, so install system packages with `apt-get` instead of `dnf`. See the [images documentation](https://vercel.com/docs/sandbox/concepts/images) for the full catalog and custom images.
