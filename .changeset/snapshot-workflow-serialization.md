---
"@vercel/sandbox": patch
---

Add workflow serialization support for the `Snapshot` class via `WORKFLOW_SERIALIZE` / `WORKFLOW_DESERIALIZE`, fixing serialization errors when a `Snapshot` instance is returned from a workflow step.
