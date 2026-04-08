---
name: sandbox
description: Creates isolated Linux MicroVMs using Vercel Sandbox SDK. Use when building code execution environments, running untrusted code, spinning up dev servers, testing in isolation, or when the user mentions "sandbox", "microvm", "isolated execution", or "@vercel/sandbox".
metadata:
  author: Vercel Inc.
  version: "1.1"
---

## _CRITICAL_: Always Use Correct `@vercel/sandbox` Documentation

Your knowledge of `@vercel/sandbox` may be outdated.
Follow these instructions before starting on any sandbox-related tasks:

### Official Resources

- **Documentation**: https://vercel.com/docs/vercel-sandbox
- **Documentation (beta)**: https://vercel.com/docs/vercel-sandbox/concepts/persistent-sandboxes
- **SDK Reference**: https://vercel.com/docs/vercel-sandbox/sdk-reference
- **CLI Reference**: https://vercel.com/docs/vercel-sandbox/cli-reference
- **GitHub**: https://github.com/vercel/sandbox
- **REST API**: https://vercel.com/docs/rest-api/sandboxes
- **REST API (Beta)**: https://vercel.com/docs/rest-api/sandboxes-v2-beta

### Quick Reference

**Essential imports:**

```typescript
// Core SDK
import { Sandbox, Snapshot, Command, CommandFinished } from "@vercel/sandbox";
import { APIError, StreamError } from "@vercel/sandbox";

// For advanced network policy with credential brokering
import type { NetworkPolicyRule, NetworkTransformer } from "@vercel/sandbox";

// For timeouts
import ms from "ms"; // e.g., ms("5m"), ms("1h")
```

**Available runtimes:**

```typescript
type RUNTIMES = "node24" | "node22" | "python3.13";
```

## Creating Sandboxes

### Basic Creation

```typescript
import { Sandbox } from "@vercel/sandbox";

const sandbox = await Sandbox.create({
  runtime: "node24",
  resources: { vcpus: 4 }, // 2048 MB RAM per vCPU
  ports: [3000], // Expose up to 15 ports
  timeout: ms("10m"), // Default: 5 minutes
  env: { NODE_ENV: "production" }, // Env vars inherited by all commands
});
```

### With Git Source

```typescript
const sandbox = await Sandbox.create({
  source: {
    type: "git",
    url: "https://github.com/vercel/sandbox-example-next.git",
    depth: 1, // Shallow clone (optional)
    revision: "main", // Branch, tag, or commit (optional)
  },
  runtime: "node24",
  ports: [3000],
});
```

### With Private Git Repository

```typescript
const sandbox = await Sandbox.create({
  source: {
    type: "git",
    url: "https://github.com/org/private-repo.git",
    username: process.env.GIT_USERNAME!,
    password: process.env.GIT_TOKEN!, // Use PAT for password
  },
  runtime: "node24",
});
```

### From Tarball

```typescript
const sandbox = await Sandbox.create({
  source: {
    type: "tarball",
    url: "https://example.com/project.tar.gz",
  },
  runtime: "node24",
  ports: [3000],
});
```

### From Snapshot

```typescript
const sandbox = await Sandbox.create({
  source: {
    type: "snapshot",
    snapshotId: "snap_abc123",
  },
  ports: [3000],
});
```

### Auto-Dispose Pattern

Use `await using` for automatic cleanup:

```typescript
async function runInSandbox() {
  await using sandbox = await Sandbox.create();
  // Sandbox automatically stopped when scope exits
  await sandbox.runCommand("echo", ["Hello"]);
}
```

## Running Commands

### Basic Command Execution

```typescript
const result = await sandbox.runCommand("npm", ["install"]);
if (result.exitCode !== 0) {
  console.error("Install failed:", await result.stderr());
}
```

### With Options

```typescript
const result = await sandbox.runCommand({
  cmd: "npm",
  args: ["run", "build"],
  cwd: "/vercel/sandbox/app",
  env: { NODE_ENV: "production" },
  sudo: false,
  stdout: process.stdout, // Stream output
  stderr: process.stderr,
});
```

### Detached Commands (Background Processes)

```typescript
// Start dev server in background
const devServer = await sandbox.runCommand({
  cmd: "npm",
  args: ["run", "dev"],
  detached: true, // Returns immediately
  stdout: process.stdout,
});

// Later: wait for completion or kill
const finished = await devServer.wait();
// Supported signals: SIGHUP, SIGINT, SIGQUIT, SIGKILL, SIGTERM, SIGCONT, SIGSTOP (or numeric)
await devServer.kill("SIGTERM");
```

### Root Access

```typescript
await sandbox.runCommand({
  cmd: "dnf",
  args: ["install", "-y", "golang"],
  sudo: true, // Execute as root
});
```

## File Operations

### Write Files

```typescript
await sandbox.writeFiles([
  {
    path: "/vercel/sandbox/config.json",
    content: Buffer.from(JSON.stringify({ key: "value" })),
  },
  {
    path: "/vercel/sandbox/script.sh",
    content: Buffer.from("#!/bin/bash\necho 'Hello'"),
  },
]);
```

### Read Files

```typescript
// Returns a Buffer object
const buffer = await sandbox.readFileToBuffer({
  path: "/vercel/sandbox/output.txt",
});

// Returns a NodeJS.ReadableStream
const stream = await sandbox.readFile({
  path: "/vercel/sandbox/large-file.bin",
});
```

### Download Files

```typescript
const localPath = await sandbox.downloadFile(
  { path: "/vercel/sandbox/report.pdf" }, // source path on the sandbox
  { path: "./downloads/report.pdf" }, // destination path on the local machine
  { mkdirRecursive: true },
);
```

### Create Directories

```typescript
await sandbox.mkDir("/vercel/sandbox/my-app/src");
```

## Network Policy

### Full Internet Access (Default)

```typescript
const sandbox = await Sandbox.create({
  networkPolicy: "allow-all",
});
```

### No Network Access

```typescript
const sandbox = await Sandbox.create({
  networkPolicy: "deny-all",
});
```

### Restricted Access (Simple Domain List)

```typescript
const sandbox = await Sandbox.create({
  networkPolicy: {
    allow: ["*.npmjs.org", "github.com", "registry.yarnpkg.com"],
    subnets: {
      allow: ["10.0.0.0/8"],
      deny: ["10.1.0.0/16"], // Takes precedence over allowed
    },
  },
});

// Update policy at runtime
await sandbox.updateNetworkPolicy({
  allow: ["api.openai.com"],
});
```

### Restricted Access with Credential Brokering

```typescript
const sandbox = await Sandbox.create({
  networkPolicy: {
    allow: {
      "ai-gateway.vercel.sh": [
        {
          transform: [
            {
              headers: { authorization: "Bearer ..." },
            },
          ],
        },
      ],
      "*": [], // Allow all other domains without transforms
    },
  },
});
```

## Snapshots

Snapshots save the entire sandbox filesystem to be reused later on, for any number of sandboxes.

### Create a Snapshot

```typescript
const sandbox = await Sandbox.create({ runtime: "node24" });

// Install dependencies
await sandbox.runCommand("npm", ["install"]);

// Create snapshot (stops the sandbox)
const snapshot = await sandbox.snapshot({
  expiration: ms("14d"), // Default: 30 days, use 0 for no expiration
});
console.log("Snapshot ID:", snapshot.snapshotId);
```

### List and Manage Snapshots

```typescript
// List snapshots
const { snapshots, pagination } = await Snapshot.list();

// Get a specific snapshot
const snapshot = await Snapshot.get({ snapshotId: "snap_abc123" });

// Delete snapshot
await snapshot.delete();
```

## Exposed Ports

```typescript
const sandbox = await Sandbox.create({
  ports: [3000, 8080],
});

// Get public URL for a port
const url = sandbox.domain(3000);
// Returns: https://subdomain.vercel.run

// Open in browser
spawn("open", [url]);
```

## Timeout Management

```typescript
const sandbox = await Sandbox.create({
  timeout: ms("10m"), // Initial timeout, default of 5 minutes
});

// Extend timeout by 5 more minutes
await sandbox.extendTimeout(ms("5m"));
// New total: 15 minutes
```

## Authentication

### Vercel OIDC Token (Recommended)

```bash
# Pull development credentials
vercel link
vercel env pull
```

The SDK automatically uses `VERCEL_OIDC_TOKEN` from environment.

### Access Token (Alternative)

```typescript
const sandbox = await Sandbox.create({
  teamId: process.env.VERCEL_TEAM_ID!,
  projectId: process.env.VERCEL_PROJECT_ID!,
  token: process.env.VERCEL_TOKEN!,
  // ... other options
});
```

## Error Handling

```typescript
import { APIError, StreamError } from "@vercel/sandbox";

try {
  const sandbox = await Sandbox.create();
} catch (error) {
  if (error instanceof APIError) {
    console.error("API Error:", error.message, error.statusCode);
  } else if (error instanceof StreamError) {
    console.error("Stream Error:", error.message);
  }
  throw error;
}
```

## Cancellation with AbortSignal

```typescript
const controller = new AbortController();

// Cancel after 30 seconds
setTimeout(() => controller.abort(), 30000);

const sandbox = await Sandbox.create({
  signal: controller.signal,
});

const result = await sandbox.runCommand({
  cmd: "npm",
  args: ["test"],
  signal: controller.signal,
});
```

## Limitations

| Limitation      | Details                                      |
| --------------- | -------------------------------------------- |
| Max vCPUs       | 8 vCPUs (2048 MB RAM per vCPU)               |
| Max ports       | 15 exposed ports                             |
| Max timeout     | 5 hours (Pro/Enterprise), 45 minutes (Hobby) |
| Default timeout | 5 minutes                                    |
| Base system     | Amazon Linux 2023                            |
| User context    | `vercel-sandbox` user                        |
| Writable path   | `/vercel/sandbox`                            |

## System Packages

Pre-installed: `git`, `tar`, `gzip`, `unzip`, `curl`, `openssl`, `procps`, `findutils`, `which`.

Install additional packages with sudo:

```typescript
await sandbox.runCommand({
  cmd: "dnf",
  args: ["install", "-y", "package-name"],
  sudo: true,
});
```

## CLI Quick Reference

```bash
# Install CLI
pnpm i -g sandbox

# Login / Logout
sandbox login
sandbox logout

# Create and connect
sandbox create --connect

# List sandboxes
sandbox ls

# Execute command
sandbox exec <sandbox-id> -- npm install

# Run a command in a new sandbox (create + exec in one step)
sandbox run -- node -e "console.log('hello')"

# Start an interactive shell
sandbox connect <sandbox-id>

# Copy files
sandbox cp local-file.txt <sandbox-id>:/vercel/sandbox/

# Stop sandbox
sandbox stop <sandbox-id>

# Snapshots
sandbox snapshot <sandbox-id>
sandbox snapshots ls
sandbox snapshots get <snapshot-id>
sandbox snapshots rm <snapshot-id>

# Update network policy
sandbox config network-policy <sandbox-id> --network-policy deny-all
```

## Common Patterns

### Dev Server Pattern

```typescript
const sandbox = await Sandbox.create({
  source: { type: "git", url: "https://github.com/org/repo.git" },
  ports: [3000],
  timeout: ms("30m"),
});

await sandbox.runCommand("npm", ["install"]);
await sandbox.runCommand({ cmd: "npm", args: ["run", "dev"], detached: true });

// Wait for server to start
await new Promise((r) => setTimeout(r, 2000));
console.log("App running at:", sandbox.domain(3000));
```

### Build and Test Pattern

```typescript
await using sandbox = await Sandbox.create({
  source: { type: "git", url: repoUrl },
});

const install = await sandbox.runCommand("npm", ["ci"]);
if (install.exitCode !== 0) throw new Error("Install failed");

const build = await sandbox.runCommand("npm", ["run", "build"]);
if (build.exitCode !== 0) throw new Error("Build failed");

const test = await sandbox.runCommand("npm", ["test"]);
process.exit(test.exitCode);
```

### Snapshot Warm Start Pattern

```typescript
// First time: create snapshot with dependencies installed
async function createBaseSnapshot() {
  const sandbox = await Sandbox.create({ runtime: "node24" });
  await sandbox.runCommand("npm", ["install", "-g", "typescript", "tsx"]);
  const snapshot = await sandbox.snapshot();
  return snapshot.snapshotId;
}

// Subsequent runs: fast start from snapshot
async function runFromSnapshot(snapshotId: string, code: string) {
  await using sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId },
  });
  await sandbox.writeFiles([
    { path: "/vercel/sandbox/index.ts", content: Buffer.from(code) },
  ]);
  return sandbox.runCommand("tsx", ["index.ts"]);
}
```

## Beta: Persistent Sandboxes (`@vercel/sandbox@beta` and `sandbox@beta`)

The beta introduces **persistent, long-lived sandboxes** with a new **Session** layer. Install with:

```bash
pnpm i @vercel/sandbox@beta  # SDK 2.0.0-beta.x
pnpm i -g sandbox@beta       # CLI 3.0.0-beta.x
```

IMPORTANT:

- This is a beta, not a stable version. Do not use for production.
- If the user had installed a previous major version (`@vercel/sandbox@1`, `sandbox@1`, `sandbox@2`), make it clear that sandboxes are by default persistent: they will automatically create snapshots to preserve the state.

### Key Concepts

- **Sandbox** = a persistent, named entity that survives across multiple VM boots.
- **Session** = a running VM instance within a sandbox. Sessions are created/resumed automatically and are identified by ID.
- Sandboxes are identified by **name** (not ID). Names are unique per project.
- When a sandbox stops, it will automatically snapshot and restore the state on the next resume (with `persistent: true`, the default).
- **Migration**: Old V1 sandboxes are backfilled with `sandboxId` as their `name` (e.g., `sbx_123`), so the only change needed is using `name` instead of `sandboxId`.

### New Exports

```typescript
import { Session } from "@vercel/sandbox";
```

### Migration from Stable (`1.x`) to Beta (`2.x`)

#### Creating sandboxes — new `name` and `persistent` params

```typescript
// Stable (1.x): anonymous, ephemeral sandboxes identified by sandboxId
const sandbox = await Sandbox.create({ runtime: "node24" });
console.log(sandbox.sandboxId);

// Beta (2.x): persistent sandboxes identified by name
const sandbox = await Sandbox.create({
  name: "my-dev-env", // Optional, random if omitted. Unique per project.
  runtime: "node24",
  persistent: true, // Default: true. Auto-snapshots on shutdown and restores on resume.
  snapshotExpiration: ms("7d"), // Optional. Default TTL for snapshots. Use 0 for no expiration.
});
console.log(sandbox.name);
```

#### Retrieving sandboxes — `name` replaces `sandboxId`

```typescript
// Stable (1.x)
const sandbox = await Sandbox.get({ sandboxId: "sbx_abc123" });

// Beta (2.x) — retrieves by name.
const sandbox = await Sandbox.get({ name: "my-dev-env" });
// Pass `resume: true` to to automatically resume the sandbox. Otherwise, it will
// be resumed when the next command is run.
const sandbox = await Sandbox.get({ name: "my-dev-env", resume: false });
```

#### Listing sandboxes — pagination and filtering changes

```typescript
// Stable (1.x): used since/until for pagination
const {
  json: { sandboxes },
} = await Sandbox.list({ since, until });

// Beta (2.x): cursor-based pagination, new filtering params
const { sandboxes, pagination } = await Sandbox.list({
  cursor: pagination.next, // string token (replaces since/until)
  namePrefix: "my-app-", // Filter by name prefix
  sortBy: "name", // "createdAt" (default) or "name"
});
```

#### Listing snapshots — new `name` filter

```typescript
// Beta (2.x): filter snapshots by sandbox name
const { snapshots } = await Snapshot.list({
  name: "my-dev-env", // Only snapshots belonging to this sandbox
});
```

#### Auto-resume for persistent sandboxes

If a sandbox created with `persistent: true` is stopped, and you call
`runCommand`, `writeFiles`, or similar SDK methods with the same sandbox name, the SDK automatically
starts a new session and retries the operation. You do not need to resume
manually.

#### New `Session` class

```typescript
// Access the current running VM session
const session = sandbox.currentSession();
console.log(session.sessionId);
console.log(session.status); // "pending" | "running" | "stopping" | "stopped" | ...
```

#### New `sandbox.update()` method (replaces `updateNetworkPolicy`)

```typescript
// Stable (1.x)
await sandbox.updateNetworkPolicy("deny-all");

// Beta (2.x) — updateNetworkPolicy still works but is deprecated
await sandbox.update({
  networkPolicy: "deny-all",
  persistent: false,
  resources: { vcpus: 4 },
  timeout: ms("30m"),
  snapshotExpiration: ms("14d"), // Update default snapshot TTL. Use 0 for no expiration.
});
```

#### New `sandbox.delete()` method

```typescript
// Permanently remove a sandbox and all its snapshots
await sandbox.delete();
```

#### New `sandbox.listSessions()` and `sandbox.listSnapshots()`

```typescript
// List all VM sessions for this sandbox
const sessions = await sandbox.listSessions();

// List snapshots belonging to this sandbox
const snapshots = await sandbox.listSnapshots();
```

### CLI Changes (3.0.0-beta)

Key differences from the stable CLI:

- All commands now use **sandbox name** instead of sandbox ID.
- `sandbox rm` / `sandbox remove` **permanently deletes** the sandbox.
- New: `sandbox sessions` command to manage sessions.
- New: `sandbox create --name <name>` to set a sandbox name.
- New: `sandbox create --snapshot-expiration <duration|none>` to set default snapshot TTL.
- New: `sandbox create --non-persistent` to disable state persistence.
- New: `sandbox run --stop` to stop the session when the command exits.
- New: `sandbox run --name <name>` resumes from an existing sandbox if it exists.
- Breaking: `sandbox run --rm` now **deletes** the sandbox (previously just stopped it).
- New: `sandbox snapshots list --name <name>` to filter snapshots by sandbox name.
- New: `sandbox config list <name>` to view sandbox configuration.
- New: `sandbox config vcpus <name> <count>` to update vCPUs.
- New: `sandbox config timeout <name> <duration>` to update timeout.
- New: `sandbox config persistent <name> <true|false>` to toggle persistence.
- New: `sandbox config snapshot-expiration <name> <duration|none>` to set default snapshot TTL.
- `sandbox cp` now uses `<sandbox_name>:path` instead of `<sandbox_id>:path`.
- `sandbox ls` supports `--name-prefix` and `--sort-by` filtering.
