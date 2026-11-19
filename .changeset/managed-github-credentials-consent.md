---
"sandbox": minor
---

Ask before creating a sandbox that requests GitHub credentials. `create`, `run`, and `sh` show the team, project, repositories, actions, and GitHub account, then ask `Create this sandbox? (y/N)`. When the project has no Bounds, they warn that nothing limits the access its sandboxes can request and ask again. `--yes` (`-y`) answers both questions. A run that cannot ask, such as CI or an AI agent, stops with exit code 2 unless `--yes` is given, and declining exits with code 130.
