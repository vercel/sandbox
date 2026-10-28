---
"sandbox": minor
---

Add `--request-header domain:header:value` and `--request-header-env domain:header:ENV_VAR` so the CLI can set an outbound request header in a network policy. Use `--request-header-env` to keep a secret out of the command line.
