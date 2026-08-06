# arch

`vercel/sandbox/arch:latest`

Minimal Arch Linux image. Use `sudo pacman -S <pkg>` for official
packages and `yay -S <pkg>` for the [AUR](https://aur.archlinux.org/).
Rolling release, rebuilt on a regular cadence to stay current.

Runs as `arch` user (uid 1000) with passwordless sudo.

## Packages

- `base-devel` and `git` (required to build AUR packages)
- `yay` (AUR helper, from `yay-bin`)
- `sudo`
