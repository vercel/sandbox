---
"sandbox-image-ubuntu": patch
"sandbox-image-node": patch
"sandbox-image-python": patch
"sandbox-image-universal": patch
"sandbox-image-al-python": patch
---

Refresh the Ubuntu snapshot for GNU C Library security fixes. Update uv, GitHub
CLI, Claude Code, Codex, and fx to their latest stable releases in the pinned
major lines. Python versions remain unchanged.

Refresh the Ubuntu snapshot to 20261114T060000Z and update pnpm to 11.28.12,
Claude Code to 2.1.325, and Codex to 0.169.0. This picks up the pnpm security
hardening and bundled dependency fix for CVE-2026-84947, Claude Code response
decoding hardening, and Codex untrusted-project configuration protections.
