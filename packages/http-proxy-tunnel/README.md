# @vercel/http-proxy-tunnel

Intercept and control HTTP requests from inside a [Vercel Sandbox](https://vercel.com/docs/sandbox). A Go-based HTTP proxy runs inside the sandbox, tunneling every request over WebSocket to your TypeScript callback where you can inspect, modify, or block it.

## Quick Start

```ts
import { Sandbox } from "@vercel/sandbox";
import { createWsProxy } from "@vercel/http-proxy-tunnel";

// Create a sandbox with an exposed port for the WebSocket
const sandbox = await Sandbox.create({ ports: [5000] });

// Attach the proxy (uploads binary, starts server, connects WebSocket)
const proxy = createWsProxy();
await proxy.attach(sandbox, { wsPort: 5000 });

// Register a handler — returns a unique HTTP_PROXY URL
const httpProxy = proxy.handle((request) => {
  console.log(`Intercepted: ${request.method} ${request.url}`);
  return new Response("blocked", { status: 403 });
});

// Run a command that uses the proxy
const result = await sandbox.runCommand({
  cmd: "curl",
  args: ["-s", "http://example.com"],
  env: {
    HTTP_PROXY: httpProxy,
    http_proxy: httpProxy,
  },
});

console.log(await result.stdout()); // "blocked"

await proxy.close();
await sandbox.stop();
```

## How It Works

```
Inside Sandbox                          Outside Sandbox
┌─────────────────────────┐
│  node app.js             │
│    ↓ HTTP_PROXY          │
│  Go Proxy (localhost)    │ ──── WebSocket ────→  TS Client A (sessions 1, 2)
│                          │ ──── WebSocket ────→  TS Client B (sessions 3, 4)
└─────────────────────────┘
```

1. `proxy.attach()` uploads a Go binary to the sandbox and starts it
2. The binary runs an HTTP proxy on localhost and a WebSocket server on an exposed port
3. The TypeScript client connects to the WebSocket from outside
4. Programs inside the sandbox set `HTTP_PROXY` to route traffic through the proxy
5. Each HTTP request is serialized, sent over WebSocket to the client that owns that session, and your callback returns the response
6. Multiple clients can share one proxy server — each registers its own sessions

## API

### `createWsProxy(): WsProxy`

Creates a new proxy instance.

### `proxy.attach(sandbox, options): Promise<void>`

Connects to the proxy server inside the sandbox. If no server is running, uploads the Go binary, installs it, and starts it. If another client already started the server, connects to the existing one.

**Options:**

| Option | Type | Required | Description |
|---|---|---|---|
| `wsPort` | `number` | Yes | Exposed port for the WebSocket server. Must be in the sandbox's `ports` list. |
| `proxyPort` | `number` | No | Port for the HTTP proxy inside the sandbox. Auto-assigned if omitted. |
| `debug` | `boolean` | No | Enable debug logging on the Go server. |
| `signal` | `AbortSignal` | No | Cancel the attach operation. |

### `proxy.handle(handler, connectHandler?): string`

Registers a callback for proxied requests and returns the `HTTP_PROXY` URL to use.

Each call creates a unique session, so different `runCommand` calls can have different handlers.

**Parameters:**

- `handler: (request: Request) => Response | Promise<Response>` — handles HTTP requests using standard Web API types
- `connectHandler?: (host: string) => boolean | Promise<boolean>` — controls HTTPS `CONNECT` tunneling (allow/deny by hostname)

**Returns:** An `HTTP_PROXY` URL string like `http://<sessionId>:x@127.0.0.1:<port>`

### `proxy.removeHandle(httpProxyValue): void`

Removes a previously registered handler by its `HTTP_PROXY` URL value.

### `proxy.close(): Promise<void>`

Disconnects the WebSocket. If this client started the proxy server, also stops it. If another client started the server, the server keeps running for other clients.

## Multiple Sessions

Each `proxy.handle()` call returns a unique `HTTP_PROXY` value, so different commands can have independent request handling:

```ts
const allowAll = proxy.handle((req) => {
  return fetch(req); // pass through
});

const blockExternal = proxy.handle((req) => {
  const url = new URL(req.url);
  if (url.hostname !== "api.internal.com") {
    return new Response("Forbidden", { status: 403 });
  }
  return fetch(req);
});

// These commands see different proxy behavior
await sandbox.runCommand({ cmd: "node", args: ["trusted.js"], env: { HTTP_PROXY: allowAll } });
await sandbox.runCommand({ cmd: "node", args: ["untrusted.js"], env: { HTTP_PROXY: blockExternal } });
```

## HTTPS Support

HTTPS requests use the HTTP `CONNECT` method to establish a tunnel. You can control this with the optional `connectHandler`:

```ts
const httpProxy = proxy.handle(
  (req) => new Response("ok"),         // handles plain HTTP
  (host) => host === "api.github.com", // only allow HTTPS to GitHub
);
```

If no `connectHandler` is provided, all HTTPS tunnels are allowed. The proxy cannot inspect encrypted HTTPS traffic — only the target hostname is visible.

## Multiple Clients

Multiple independent proxy clients can share the same sandbox. The second `attach()` detects the running server and connects to it — no duplicate binary or port conflict:

```ts
const sandbox = await Sandbox.create({ ports: [5000] });

const proxyA = createWsProxy();
await proxyA.attach(sandbox, { wsPort: 5000 }); // starts the server

const proxyB = createWsProxy();
await proxyB.attach(sandbox, { wsPort: 5000 }); // connects to existing server

const handleA = proxyA.handle(() => new Response("from A"));
const handleB = proxyB.handle(() => new Response("from B"));

// Each command routes to the correct client
await sandbox.runCommand({ cmd: "curl", args: ["-s", "http://x.com"], env: { HTTP_PROXY: handleA } });
await sandbox.runCommand({ cmd: "curl", args: ["-s", "http://x.com"], env: { HTTP_PROXY: handleB } });
```

Session ownership is tracked via `register`/`unregister` messages over the WebSocket. When a client disconnects, its sessions are automatically cleaned up.

## Re-attaching

The proxy supports re-attaching to the same sandbox after disconnecting:

```ts
await proxy.close();

// Later...
const proxy2 = createWsProxy();
await proxy2.attach(sandbox, { wsPort: 5000 });
```

The Go binary is only uploaded once — subsequent attaches reuse the installed binary.

## Architecture

- **Go binary** (`packages/http-proxy-server/`): HTTP proxy + WebSocket server running inside the sandbox
- **TypeScript client** (`packages/http-proxy-tunnel/`): WebSocket client that routes requests to JS callbacks
- **Multi-client**: The Go server accepts multiple WebSocket connections. Each client registers its session IDs. The proxy routes each request to the client that owns the session.
- **Session routing**: Uses HTTP proxy authentication (`Proxy-Authorization: Basic`) to map requests to the correct callback. The session ID is encoded as the username in the `HTTP_PROXY` URL.
- **Protocol**: JSON messages over WebSocket for request/response serialization, with base64-encoded bodies.
- **Config persistence**: The server writes connection info to `/tmp/vercel/http-proxy/config.json` inside the sandbox so subsequent clients can discover and connect to the running server.
