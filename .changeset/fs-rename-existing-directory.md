---
"@vercel/sandbox": patch
"@vercel/sandbox-mock": patch
---

Make `sandbox.fs.rename()` replace an existing empty directory at the destination instead of moving the source inside it, matching `fs.rename()` in Node.js.
