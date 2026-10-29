---
"sandbox": minor
---

Limit a `--request-header` or `--request-header-from-env` header to chosen HTTP methods with a `[method=GET,HEAD]` prefix, for example `'[method=GET,HEAD]registry.npmjs.org:authorization=NPM_AUTH'`. Headers without the prefix still apply to every request.
