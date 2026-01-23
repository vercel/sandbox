# @vercel/pty-tunnel

A WebSocket-based pseudo-terminal (PTY) tunneling library that enables remote terminal access through a multiplexer server.

## Overview

This package provides utilities to create secure, real-time terminal connections over WebSocket. It works with a companion `pty-tunnel-server` that acts as a multiplexer, allowing multiple clients to connect to the same process.

## Key Features

- **WebSocket-based tunneling**: Uses WebSocket for reliable terminal communication
- **Multiplexer architecture**: Connects to a supervisor server that manages process connections
- **Message serialization**: Efficient binary protocol for terminal messages, resize events, and control signals
- **Stdin capture**: Raw mode terminal input handling for interactive sessions
- **Multi-client support**: Multiple clients can connect to the same process

## API

### Core Functions

- `createListener()` - Creates a WebSocket-based listener that connects to the pty-tunnel-server
- `captureStdin({ redirectTo })` - Captures raw stdin and forwards to remote terminal
- `Message` types - Terminal data, resize events, and ready signals
- `ListenerSocket` - Typed WebSocket class for pty-tunnel messages

### Message Types

- `message` - Terminal output/input data
- `resize` - Terminal resize events (cols, rows)
- `ready` - Connection ready signal

## Usage

### Client Side

```typescript
import { createListener, captureStdin } from "@vercel/pty-tunnel";

// Create WebSocket listener (connects to pty-tunnel-server)
const { connection, stdoutStream } = createListener();

// Wait for connection info from server
const conn = await connection;

// Create WebSocket client
const client = conn.createClient("ws://localhost");
await client.waitForOpen();

// Capture local stdin and forward to remote
const cleanup = captureStdin({
  redirectTo: client,
});

// Handle connection
client.sendMessage({ type: "ready" });
```

## Architecture

This package works in conjunction with `pty-tunnel-server`:

1. The server runs a multiplexer that listens on a WebSocket port
2. Processes connect as "process" type clients to the server
3. CLI clients connect as "client" type to communicate with processes
4. Message flow is bidirectional through the WebSocket connection

The `pty-tunnel-server` can run in three modes:

- `server`: Runs the multiplexer server
- `client`: Spawns a detached server if needed, then connects as a process
- `single`: Runs server and client in the same process (mainly for testing)

## Dependencies

- `debug` - Debugging utilities

## Development

```bash
# Build
pnpm build

# Test
pnpm test
```
