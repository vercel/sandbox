---
"sandbox": minor
---

Add experimental managed GitHub credentials to `create`, `run`, and `sh`. `--credentials-github-repository OWNER/REPOSITORY` clones the repository into the sandbox and lets it use Git and the GitHub API there, with no GitHub token inside the sandbox. `--credentials-github-actions` replaces the default actions, and `--credentials-github-act-as` chooses the GitHub account. `--credentials-file <FILE>` (use `-` for stdin) reads the whole credentials request as JSON in the SDK's `credentials` shape, for requests such as several repositories.
