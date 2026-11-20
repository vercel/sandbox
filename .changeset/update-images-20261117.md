---
"sandbox-image-ubuntu": patch
"sandbox-image-node": patch
"sandbox-image-python": patch
"sandbox-image-universal": patch
"sandbox-image-al-base": patch
"sandbox-image-al-node": patch
"sandbox-image-al-python": patch
---

Refresh the Ubuntu package snapshot to 20261120T060000Z, the Amazon Linux
base to 2023.12.20261117.0, Python sources to 3.14.10 and 3.15.2 with verified
XZ checksums, pnpm to 11.28.13, uv to 0.13.9, GitHub CLI to 2.105.0, Claude
Code to 2.1.329, Codex to 0.171.0, OpenCode to 1.19.6, and Bun to 1.4.5. Include Python, Bun,
and Amazon Linux security fixes and package-manager policy hardening.
Keep the Python versions written directly in targets unchanged.
