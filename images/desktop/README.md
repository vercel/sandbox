# desktop

`vercel/sandbox/desktop:latest`

A Linux desktop that can be viewed in a browser, on top of the [ubuntu](../ubuntu) base image.
Nothing starts automatically; start the VNC server, window manager, and websockify yourself.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

- `tigervnc-standalone-server` (`Xvnc`)
- `fluxbox`
- `novnc` and `python3-websockify` (`websockify`)
- `xterm`
- `xdotool`, `scrot`, and `x11-utils` (input, screenshots, and `xdpyinfo`)
- `fonts-dejavu-core`
- `python3`
- `iproute2` (`ss`) and `procps` (`pgrep`, `pkill`)

## Example

```sh
Xvnc :1 -geometry 1280x800 -SecurityTypes None -localhost yes &
DISPLAY=:1 fluxbox &
DISPLAY=:1 xterm &
websockify --web /usr/share/novnc 6080 localhost:5901
```

Then open `/vnc.html` on the sandbox's port 6080.
