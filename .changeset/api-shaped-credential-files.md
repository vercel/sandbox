---
"sandbox": patch
---

Managed-credential JSON files now use API field names: `source.type`, `source.url`, and `credentials.github[].repositories`. Canonical files, persisted output, reuse, and creation requests preserve repository grouping, actions, actors, and source options without field translation. CLI-only `repo` fields and noncanonical JSON aliases are rejected.
