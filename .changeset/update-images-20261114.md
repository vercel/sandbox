---
"sandbox-image-ubuntu": patch
"sandbox-image-node": patch
"sandbox-image-python": patch
"sandbox-image-universal": patch
---

Refresh the Ubuntu base image digest and snapshot to 20261116T060000Z. Update
pnpm to 11.28.12, Claude Code to 2.1.325, Codex to 0.169.0, and fx to 0.0.17.
Include pnpm registry hardening and bundled dependency cleanup (attributed to
CVE-2026-84947 by pnpm's release notes), Claude Code response-decoding and
permission hardening, Codex project-trust protections, and fx terminal and
credential hardening. Keep Python versions unchanged.
