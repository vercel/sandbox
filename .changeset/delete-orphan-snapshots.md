---
"@vercel/sandbox": minor
"@vercel/sandbox-mock": patch
"sandbox": minor
---

Add a `deleteOrphanSnapshots` option when deleting a sandbox.

Deleting a persistent sandbox left all of its snapshots alive until they expired. `sandbox.delete({ deleteOrphanSnapshots: true })` in the SDK and `sandbox remove <name> --delete-orphan-snapshots` in the CLI now also delete the snapshots of that sandbox that no other sandbox uses. It defaults to `false`, so the existing behaviour is unchanged.
