# desktop

`vercel/sandbox/desktop:latest`

A Linux desktop that can be viewed in a browser, on top of the [ubuntu](../ubuntu) base image.
Nothing starts automatically; start and secure the VNC server, window manager, and websockify yourself.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

- `tigervnc-standalone-server` and `tigervnc-tools` (`Xvnc`, `tigervncpasswd`)
- `fluxbox`
- `novnc` and `python3-websockify` (`websockify`)
- `xterm`
- `xdotool`, `scrot`, and `x11-utils` (input, screenshots, and `xdpyinfo`)
- `fonts-dejavu-core`
- `python3`
- `iproute2` (`ss`) and `procps` (`pgrep`, `pkill`)

## Security

Anyone who can reach an exposed VNC or websockify port controls the desktop, including its
terminal. Sandbox ports are public, so always require a VNC password or other authentication
before exposing one.
