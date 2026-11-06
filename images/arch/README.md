# arch

`vercel/sandbox/arch:latest`

Minimal Arch Linux image. Use `sudo pacman -S <pkg>` for official
packages and `yay -S <pkg>` for the [AUR](https://aur.archlinux.org/).
The `archlinux:latest` base and OS libraries remain rolling; only the tools
below are pinned. Rebuilt on a regular cadence to stay current.

Runs as `arch` user (uid 1000) with passwordless sudo.

## Packages

- Git `2.56.0`, built from the official kernel.org source archive into `/opt/git`
- yay `13.0.1`, installed from the upstream x86_64 release binary
- `base-devel` and distro `git`, retained for AUR builds and package dependencies
- `sudo`, plus Git runtime dependencies `curl`, `expat`, `zlib`, and `perl`

Bake supplies the shared `GIT_VERSION`, `GIT_SHA256`, `YAY_VERSION`, and
`YAY_SHA256` build arguments; the Dockerfile has no defaults. Both downloads
are SHA-256 verified. `/opt/git/bin` takes PATH priority over distro Git, and
build-time smoke checks verify the exact Git and yay versions as `arch`.
