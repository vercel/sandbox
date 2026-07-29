# universal

`vercel/sandbox/universal:latest`

The default image, built on the [ubuntu](../ubuntu) base
image. Contains common tooling for most use cases.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

### Runtimes

- Node.js 24 with `npm`, `npx`, `corepack` and
  `pnpm` 10
- Python 3.14 with `pip`, `venv`, `uv` and
  `python-is-python3`

### Coding agents

- opencode (`opencode`)
- Claude Code (`claude`)
- Codex (`codex`)
- pi (`pi`)

### Utilities

- `awscli` (v2)
- `curl`, `wget`
- `git`, `git-lfs` (hooks pre-configured), `gh`
- `jq`, `ripgrep`, `fzf`, `tree`, `file`, `less`
- `vim`, `nano`, `tmux`
- `rsync`
- `sqlite3`
- `unzip`, `zip`, `xz-utils`, `bzip2`
- `gnupg`, `openssl`
- `sudo`, `procps`
- Network/debug tools: `iproute2` (`ss`), `lsof`, `netcat-openbsd` (`nc`),
  `dnsutils` (`dig`), `iputils-ping` (`ping`)
