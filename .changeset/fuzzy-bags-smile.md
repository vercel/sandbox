---
"@vercel/sandbox": major
"@vercel/sandbox-mock": major
"sandbox": major
---

Add support for Vercel Managed Images and deprecate the `runtime` option in the SDK and CLI. Runtime-based creation remains supported through the legacy v2 API; image-based and default creation use the v3 API. Passing both `runtime` and `image` is an error.

Sandboxes that do not specify an image now use `vercel/sandbox/universal`. The previous default was the `node24` runtime on Amazon Linux 2023. The new default is based on Ubuntu and includes Node.js 24, Bun, Python 3.14, coding agents, and common development and debugging tools.

Existing `runtime` calls continue to work, it's recommended to migrate to Vercel managed images when possible:

- Not using `runtime`: omit `image` to use the new Universal image, or set `image: "vercel/sandbox/node:24"` for an Ubuntu-based Node.js equivalent to the previous default.
- Using `runtime: "node22"`: use `image: "vercel/sandbox/node:22"` for an Ubuntu-based equivalent.
- Using `runtime: "node24"`: use `image: "vercel/sandbox/node:24"` for an Ubuntu-based equivalent.
- Using `runtime: "node26"`: use `image: "vercel/sandbox/node:26"` for an Ubuntu-based equivalent.
- Using `runtime: "python3.13"`: use `image: "vercel/sandbox/python:3.14"` for an Ubuntu-based equivalent, and note the Python version upgrade.
