---
"sandbox": minor
---

Add `sandbox read <name> <path>` (alias `cat`) and `sandbox write <name> <path>` to read a sandbox file to stdout and write stdin to a sandbox file, and `sandbox copy --recursive` to copy whole directories in either direction. Failed copies now exit with a non-zero code.
