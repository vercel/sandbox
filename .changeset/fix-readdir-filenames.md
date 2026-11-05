---
"@vercel/sandbox": patch
"@vercel/sandbox-mock": patch
---

Fix `sandbox.fs.readdir()` returning incorrect names or extra entries for filenames containing newlines, `|`, or surrounding whitespace. Listings now include dotfiles, use a consistent name order, and follow a symlinked directory with `withFileTypes: true`. Relative directory paths such as `-delete` are treated literally.

Upgrade `@vercel/sandbox-mock` together with `@vercel/sandbox`, as older mocks fail these `readdir()` calls with `ENOENT`.
