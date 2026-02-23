---
"@vercel/sandbox": minor
---

Add Workflow DevKit serialization support. Sandbox, Command, CommandFinished, and Snapshot classes now implement `WORKFLOW_SERIALIZE` and `WORKFLOW_DESERIALIZE` symbols from `@workflow/serde`, enabling instances to be passed across workflow/step serialization boundaries. All API-calling methods are annotated with `"use step"` for durable execution compatibility.
