---
"sandbox": patch
---

Fix `sandbox connect` hanging or failing on a stopped/resumed sandbox. The interactive shell now surfaces `attach()` failures instead of swallowing them once the connection handshake lands, always stops the spinner on teardown (so a failure can no longer hang the process), and includes the in-sandbox server's stderr when the interactive server exits early. The in-sandbox `vc-interactive-server` also health-checks a reused server before trusting a leftover config file, so a stale `/tmp/vercel/interactive/config.json` restored from a snapshot no longer causes it to connect to a dead socket.
