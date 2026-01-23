# @vercel/pty-tunnel

## 2.0.3

### Patch Changes

- fix short-running commands that are not interactive (like 'env' or 'echo') but use pty ([#193](https://github.com/vercel/sandbox-sdk/pull/193))

## 2.0.2

### Patch Changes

- support node.js v20 (by using `ws` instead of global WebSocket) ([#174](https://github.com/vercel/sandbox-sdk/pull/174))

## 2.0.1

### Patch Changes

- change license to MIT (more permissive, therefore not breaking change) ([#169](https://github.com/vercel/sandbox-sdk/pull/169))

- have connection timeouts that disconnect the websockets ([#173](https://github.com/vercel/sandbox-sdk/pull/173))

- Make interactive sandbox command execution use WebSocket instead of WebRTC to support more diverse network conditions. ([#164](https://github.com/vercel/sandbox-sdk/pull/164))

## 2.0.0

## 2.0.0-beta.0

### Major Changes

- starting a beta ([#147](https://github.com/vercel/sandbox-sdk/pull/147))

## 1.0.1

### Patch Changes

- convert to esm ([#140](https://github.com/vercel/sandbox-sdk/pull/140))
