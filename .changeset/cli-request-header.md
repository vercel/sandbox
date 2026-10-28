---
"sandbox": minor
---

Add `--request-header domain:header=value` and `--request-header-from-env domain:header=ENV_VAR` so the CLI can set an outbound request header in a network policy. Use `--request-header-from-env` to keep a secret out of the command line.
