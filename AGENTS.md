# Agents

## Changesets

This repo uses [changesets](https://github.com/changesets/changesets) for versioning. When making changes to any package, add a changeset by running `pnpm changeset` or by creating a markdown file in `.changeset/` with the following format:

```md
---
"package-name": patch
---

A short description of the change.
```

Use `patch` for bug fixes, cosmetic changes, and DX improvements. Use `minor` for new features. Use `major` for breaking changes.
