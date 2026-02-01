---
name: sandbox
description: Creates isolated Linux MicroVMs using Vercel Sandbox SDK. Use when building code execution environments, running untrusted code, spinning up dev servers, testing in isolation, or when the user mentions "sandbox", "microvm", "isolated execution", or "@vercel/sandbox".
metadata:
  author: Vercel Inc.
  version: '1.0'
---

## *CRITICAL*: Always Use Correct `@vercel/sandbox` Documentation

Your knowledge of `@vercel/sandbox` may be outdated.
Follow these instructions before starting on any sandbox-related tasks:

### Official Resources

- **Documentation**: https://vercel.com/docs/vercel-sandbox
- **SDK Reference**: https://vercel.com/docs/vercel-sandbox/sdk-reference
- **CLI Reference**: https://vercel.com/docs/vercel-sandbox/cli-reference
- **GitHub**: https://github.com/vercel/sandbox

### Quick Reference

**Essential imports:**

```typescript
// Core SDK
import { Sandbox, Snapshot, Command, CommandFinished } from "@vercel/sandbox";
import { APIError, StreamError } from "@vercel/sandbox";

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
  ports: [3000], // Expose up to 4 ports
  timeout: ms("10m"), // Default: 5 minutes
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

### From Snapshot (Fast Cold Start)

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
// As Buffer
const buffer = await sandbox.readFileToBuffer({ path: "/vercel/sandbox/output.txt" });

// As Stream
const stream = await sandbox.readFile({ path: "/vercel/sandbox/large-file.bin" });
```

### Download Files

```typescript
const localPath = await sandbox.downloadFile(
  { path: "/vercel/sandbox/report.pdf" },
  { path: "./downloads/report.pdf" },
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
  networkPolicy: { type: "internet-access" },
});
```

### No Network Access

```typescript
const sandbox = await Sandbox.create({
  networkPolicy: { type: "no-access" },
});
```

### Restricted Access

```typescript
const sandbox = await Sandbox.create({
  networkPolicy: {
    type: "restricted",
    allowedDomains: ["*.npmjs.org", "github.com", "registry.yarnpkg.com"],
    allowedCIDRs: ["10.0.0.0/8"],
    deniedCIDRs: ["10.1.0.0/16"], // Takes precedence over allowed
  },
});

// Update policy at runtime
await sandbox.updateNetworkPolicy({
  type: "restricted",
  allowedDomains: ["api.openai.com"],
});
```

## Snapshots

Snapshots save sandbox state for fast restarts (~100ms cold start).

### Create a Snapshot

```typescript
const sandbox = await Sandbox.create({ runtime: "node24" });

// Install dependencies
await sandbox.runCommand("npm", ["install"]);

// Create snapshot (stops the sandbox)
const snapshot = await sandbox.snapshot();
console.log("Snapshot ID:", snapshot.snapshotId);
```

### List and Manage Snapshots

```typescript
// List snapshots
const { snapshots } = await Snapshot.list();

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
  timeout: ms("10m"), // Initial timeout
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

| Limitation | Details |
|------------|---------|
| Max vCPUs | 8 vCPUs (2048 MB RAM per vCPU) |
| Max ports | 4 exposed ports |
| Max timeout | 5 hours (Pro/Enterprise), 45 minutes (Hobby) |
| Default timeout | 5 minutes |
| Base system | Amazon Linux 2023 |
| User context | `vercel-sandbox` user |
| Writable path | `/vercel/sandbox` |

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

# Login
sandbox login

# Create and connect
sandbox create --connect

# List sandboxes
sandbox ls

# Execute command
sandbox exec <sandbox-id> -- npm install

# Copy files
sandbox cp local-file.txt <sandbox-id>:/vercel/sandbox/

# Stop sandbox
sandbox stop <sandbox-id>
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
await new Promise(r => setTimeout(r, 2000));
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
