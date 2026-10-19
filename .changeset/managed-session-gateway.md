---
"sandbox": minor
"@vercel/sandbox": minor
---

Enable AI Gateway with `sandbox create --ai`, or add `--image my-image` for Gateway access without rewriting custom image configuration. On the universal image, prepare all four coding agents or launch one with `sandbox create --ai codex`. Use backend-managed AI Gateway credentials per session by default. Print the credential mode after setup; never silently fall back to another mode. Managed credentials require the backend rollout.
