---
"sandbox": patch
---

Sandbox-lookup 404 errors are now quiet and actionable: the error states the name was not found, the status code, and a closing hint to run `sandbox ls`. The request URL and response-buffer path move behind `DEBUG=sandbox:errors`.
