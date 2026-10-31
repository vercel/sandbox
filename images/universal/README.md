# universal

`vercel/sandbox/universal:latest`

The default image, built on the [python](../python) image (and its
[ubuntu](../ubuntu) base). Contains common tooling for most use cases.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

All explicitly pinned tools, including coding agents, use the
[shared Bake versions](../README.md#shared-tool-versions), not independent
Dockerfile defaults. Node.js uses `NODE_VERSIONS[NODE_LTS_MAJOR]`; Python, pip, uv,
and source-built Git are inherited from the Python/Ubuntu base chain. GitHub CLI
and Git LFS use checksum-verified release archives, and Bun uses a versioned image.
OS utilities and libraries remain managed by `apt` for rolling security updates;
these pins do not make OS contents or transitive dependencies fully reproducible.

## Packages

### Runtimes

- Node.js LTS (24) with `npm`, `npx`, and pinned `pnpm`
- Bun (`bun`, `bunx`)
- Python 3.14.10 with `python`, `python3`, `pip`, `pip3`, `venv`, `uv`, and `uvx`,
  inherited from the Python image

### Coding agents

- opencode (`opencode`)
- Claude Code (`claude`)
- Codex (`codex`)
- pi (`pi`)
- fx (`fx`)

### Utilities

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
