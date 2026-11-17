# desktop

`vercel/sandbox/desktop:latest`

A Linux desktop you can watch in a browser and control from the shell, using
[screen-relay](https://github.com/vercel-labs/relay) on top of the
[node](../node) image (Node.js 24). The screen-relay engine is already built
for the X11 backend, so `screen-relay up` starts a desktop without installing
anything first.

Runs as the default `ubuntu` user (uid 1000) with passwordless sudo.

## Packages

- `screen-relay` (installed with npm), with its engine built under `~/.local/share/screen-relay`
- Xvfb and the XFCE desktop (`xfce4-session`, `xfwm4`, `xfce4-panel`, `thunar`, `xfce4-terminal`)
- `xdotool`, for sending input to the display while a viewer holds screen-relay's single input connection
- The build tools and libraries the engine needs (`build-essential`, `libx264-dev`, `libwebsockets-dev`, and the X11 development libraries)
- Everything in the [node](../node) image: Node.js, npm, pnpm, curl, and git

## Usage

Create the sandbox with port 8080 published, then start screen-relay with that
port's public URL:

```sh
screen-relay up -d --public "https://<sandbox domain for port 8080>"
screen-relay screenshot /tmp/screen.png
```

`up` prints a viewer link to open in a browser.

## Security

`--public` creates one 256-bit token for the session and puts it in the viewer
link's `#token=` fragment. The token is valid until `screen-relay down`. Anyone
with the link can watch and control the desktop, including its terminal, so
share it only with people who should have that access. Without
`--public`, screen-relay listens only on `127.0.0.1:8080`.
