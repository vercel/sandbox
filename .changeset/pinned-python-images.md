---
"sandbox-image-arch": patch
"sandbox-image-node": patch
"sandbox-image-python": patch
"sandbox-image-ubuntu": patch
"sandbox-image-universal": patch
---

Centralize tool version pins in the Bake configuration for maintained Ubuntu, Node, Python, Universal, and Arch images. Pin pip, uv, pnpm, Bun, Git, Git LFS, GitHub CLI, coding agents, fx, and yay, with archive checksums and installed-version checks. Keep the Node.js major-to-exact-version map shared with Universal.

Pin Python to 3.14.10, build it from verified upstream source, and reuse it in Universal. Publish `3.14` and `3.14.10` Python tags. Build the shared Git version from verified source in Ubuntu and Arch.

Leave all legacy `al-*` images and their Bake settings unchanged. Distro-managed OS packages remain rolling for security updates; tool pins do not freeze transitive dependencies or OS contents.
