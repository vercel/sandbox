# @vercel/pty-tunnel-server

A self-contained Go-based WebSocket PTY tunnel server that enables secure remote terminal access without requiring Node.js or any runtime dependencies.

## Overview

This is a standalone Go server implementation that provides WebSocket-based pseudo-terminal tunneling. It serves as the server counterpart to the [`@vercel/pty-tunnel`](../pty-tunnel) Node.js client library, enabling secure remote shell access through WebSocket connections. The Go implementation allows deployment in any environment without Node.js dependencies and replaces the previous WebRTC implementation for better network compatibility.

## Features

- **Runtime independence**: Self-contained binary with no external runtime dependencies
- **Universal deployment**: Can run on any system without requiring Node.js installation
- **WebSocket connectivity**: Uses Gorilla WebSocket library for reliable network connections
- **Three execution modes**: Server daemon, client, and single-process modes for flexible deployment
- **Cross-platform binaries**: Builds for Linux x86_64 and ARM64 architectures
- **PTY management**: Full pseudo-terminal lifecycle management using creack/pty
- **Message buffering**: Intelligent buffering for optimal data transmission
- **Multi-client support**: Multiple clients can connect to the same process session

## Architecture

The server uses a three-actor WebSocket-based message bus architecture:

1. **CLI Client (Actor 3)** - Connects from user's local machine via WebSocket
2. **WebSocket Server (Actor 1)** - Message routing hub inside sandbox
3. **Sandbox Process (Actor 2)** - PTY runner connecting via local WebSocket

Messages route: CLI Client ↔ WebSocket Server ↔ Sandbox Process

### Components

- **WebSocket Server** (`ws/`) - WebSocket connection management and message bus
- **Command modes** (`cmd/`) - Three execution modes and process bootstrappers
- **Protocol definitions** (`protocol/`) - Binary message format specifications
- **Message handling** (`glue/`) - Protocol message parsing and PTY interaction
- **Buffering** (`buffering/`) - I/O buffering for efficient data transmission
- **Config utilities** (`config/`) - Configuration and utility functions

### Execution Modes

The server can run in three distinct modes:

1. **`server`** - Runs as a multiplexer/supervisor daemon that listens on a WebSocket port
2. **`client`** - Checks for existing server, spawns detached process if needed, then connects as a process
3. **`single`** - Runs the server in-process, mainly used for testing

## Usage

This server is designed to work with the [`@vercel/pty-tunnel`](../pty-tunnel) client library. The client establishes WebSocket connections and communicates through the message bus.

### Command Line

```bash
pty-tunnel-server [OPTIONS] [command] [args...]
```

**Options:**

- `--mode=<mode>`: Execution mode (`server`, `client`, or `single`) [default: `single`]
- `--token=<token>`: Authentication token for WebSocket connections
- `--port=<port>`: Port for server mode (0 for random port)
- `--cols=<columns>`: Terminal width in columns [default: 80]
- `--rows=<rows>`: Terminal height in rows [default: 24]
- `--config=<path>`: Server config file path [default: `/tmp/vercel/interactive/config.json`]
- `--debug`: Enable debug logging
- `--help`: Show help message
- `--version`: Show version information

### Examples

**Server Mode (Daemon):**

```bash
# Start WebSocket server daemon
pty-tunnel-server --mode=server --port=8080 --token=mytoken123
```

**Client Mode:**

```bash
# Connect to existing server or spawn new one, then run bash
pty-tunnel-server --mode=client --cols=80 --rows=24 bash

# Run specific command
pty-tunnel-server --mode=client python3 -c "print('Hello World')"
```

**Single Mode (Testing):**

```bash
# Run server and process in same binary (for testing)
pty-tunnel-server --mode=single --token=testtoken bash
```

### WebSocket Connection

The server listens for WebSocket connections with two connection types:

- **Process connections** (`/ws/process?token=<token>&processId=<id>`): PTY host connections
- **Client connections** (`/ws/client?token=<token>&processId=<id>`): CLI client connections

Each process connects as a "process" type, and multiple clients can connect to the same process ID.

## Building from Source

### Prerequisites

- Go 1.22.0 or later

### Build

```bash
# Build binaries for all supported architectures
pnpm run build

# Or build manually
go build -o pty-tunnel-server

# Cross-compile for Linux
GOOS=linux GOARCH=amd64 go build -o pty-tunnel-server-linux-amd64
GOOS=linux GOARCH=arm64 go build -o pty-tunnel-server-linux-arm64
```

## Dependencies

- **[github.com/creack/pty](https://github.com/creack/pty)** - Cross-platform PTY interface
- **[github.com/gorilla/websocket](https://github.com/gorilla/websocket)** - WebSocket implementation for Go

## Protocol

The server communicates using a binary message protocol over WebSocket connections, compatible with [`@vercel/pty-tunnel`](../pty-tunnel):

### Message Types

- **Message** (type 0): Terminal data (stdin/stdout)
- **Resize** (type 1): Terminal resize events (columns × rows)
- **Ready** (type 2): Connection ready signal

### Message Format

Messages are encoded as binary WebSocket frames with the following structure:

```
[message_type:uint8][payload:bytes...]
```

- **Resize payload**: 4 bytes (cols:uint16, rows:uint16) in big-endian format
- **Message payload**: Raw terminal data bytes
- **Ready payload**: Empty (0 bytes)

### WebSocket Endpoints

- `/ws/process?token=<auth_token>&processId=<process_id>` - For PTY host processes
- `/ws/client?token=<auth_token>&processId=<process_id>` - For CLI clients
- `/health` - Health check endpoint

Authentication is required via token parameter, and each connection must specify a processId for message routing.

## Development

```bash
# Run tests
go test ./...

# Build and test locally
go build -o pty-tunnel-server
```
