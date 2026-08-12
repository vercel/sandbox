---
"sandbox": patch
---

Remove first-run dead ends from the CLI: `create` and `fork` output now ends
with a "connect with: sandbox ssh <name>" hint; `create`/`sh`/`run` check for
a newer published CLI concurrently with sandbox creation and print an update
notice when the install is stale (disable with `SANDBOX_SKIP_VERSION_CHECK=1`);
sandbox-lookup 404s suggest `sandbox ls`; and `sandbox sh <command>` explains
that `sh` takes no command and points at `sandbox run --rm -i <command>`.
