---
"sandbox": minor
---

Add `github` to `--credentials` on `create`, `run`, and `sh` (experimental). `--credentials=github` clones the GitHub repository of the current directory into the sandbox and requests the default access to it. The `--credentials-github-actions` and `--credentials-github-act-as` options now apply to that repository when `--credentials-github-repository` is absent. Combining `github` in `--credentials` with a `--credentials-github-*` option is an error. When a request is not approved, the CLI prints the command that states it in full, so you can edit and rerun it.
