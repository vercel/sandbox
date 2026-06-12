---
"sandbox": patch
---

Prettify timeout and API errors. The CLI now renders any API error (400/4xx/5xx) from any command, plus request timeouts, aborts and stream interruptions, with the consistent styled layout instead of dumping a raw stack trace. Unknown errors print a single line; set `DEBUG=sandbox:errors` to see the full stack.
