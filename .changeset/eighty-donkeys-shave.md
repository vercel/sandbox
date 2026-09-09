---
"sandbox": minor
---

Interactive sessions started without a command (`sandbox connect`/`ssh`/`shell`, `sandbox create --connect`, `sandbox fork --connect`, `sandbox sh`) now open the shell the sandbox account declares in its passwd entry, as a login shell, instead of a hardcoded `sh`. An image that gives its user zsh — or installs the usual shell somewhere else — gets the shell the account actually configures, with its profile sourced.

Adding `--sudo` opens the target account's login shell the same way (`sudo --login`), which starts in that account's home directory rather than `--workdir`. Explicit commands (`sandbox exec`, `sandbox run`) are unchanged.
