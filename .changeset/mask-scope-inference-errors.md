---
"@vercel/sandbox": patch
"sandbox": patch
---

Fix scope inference failing with a raw Zod validation error. Teams missing `updatedAt` are now kept and malformed team entries are skipped. The CLI also no longer leaks raw validation details when scope can't be determined, showing a friendly hint instead. OAuth response parse failures are masked the same way.
