---
"@vercel/sandbox": minor
"@vercel/sandbox-mock": minor
"sandbox": minor
---

`read-only` mounts have been replaced by snapshots: you can now mount the same drive on many sandboxes at once, using read-only snapshots:

```ts
await Sandbox.create({
  mounts: {
    '/data': drive.snapshot()
  }
})
```
