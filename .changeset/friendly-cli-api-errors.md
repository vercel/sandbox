---
"sandbox": patch
---

Show friendly, contract-aware errors for failed Sandbox API requests instead of dumping raw `APIError` stack traces. API errors thrown by instance methods (e.g. `extendTimeout`, `runCommand`, `stop`, `delete`) are now handled too, not just the static client factories — at the top level for most commands, and inline for multi-target commands that render per-item errors (`stop`, `remove`, `snapshots delete`). Known errors (such as exceeding the maximum execution timeout) surface the API's user-facing message, while internal/unexpected errors (5xx, `internal_server_error`, or unparseable responses) show a generic message with the full response saved to a temp file for debugging. Non-API errors print their message only; the full stack trace is shown when the `DEBUG` env var is set.
