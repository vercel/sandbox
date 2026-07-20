import type {
  CommandRecord,
  SandboxRecord,
  SessionRecord,
  SnapshotRecord,
} from "./registry.js";

/**
 * Coerce a stored network policy into a shape the SDK's response validator
 * accepts (`{ mode }` or the legacy custom object). Requests may carry a V2
 * `{ allow }` object, which the response schema rejects, so anything that is
 * not already mode-based is reported as `{ mode: "custom" }`.
 */
function responseNetworkPolicy(policy: unknown): unknown {
  if (policy == null || typeof policy !== "object") return undefined;
  if ("mode" in (policy as Record<string, unknown>)) return policy;
  return { mode: "custom" };
}

function subdomain(name: string, port: number): string {
  return `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${port}`;
}

export function routePayload(name: string, port: number) {
  const sub = subdomain(name, port);
  return { url: `https://${sub}.vercel.run`, subdomain: sub, port };
}

export function routesPayload(name: string, ports: number[]) {
  return ports.map((port) => routePayload(name, port));
}

export function sessionPayload(session: SessionRecord) {
  return {
    id: session.id,
    memory: session.memory,
    vcpus: session.vcpus,
    region: session.region,
    runtime: session.runtime,
    timeout: session.timeout,
    status: session.status,
    requestedAt: session.requestedAt,
    startedAt: session.startedAt,
    requestedStopAt: session.requestedStopAt,
    stoppedAt: session.stoppedAt,
    snapshottedAt: session.snapshottedAt,
    duration: session.duration,
    sourceSnapshotId: session.sourceSnapshotId,
    createdAt: session.createdAt,
    cwd: session.cwd,
    updatedAt: session.updatedAt,
    interactivePort: session.interactivePort,
    networkPolicy: responseNetworkPolicy(session.networkPolicy),
    activeCpuDurationMs: session.activeCpuDurationMs,
    networkTransfer: session.networkTransfer,
  };
}

export function sandboxPayload(sandbox: SandboxRecord, session: SessionRecord) {
  return {
    name: sandbox.name,
    persistent: sandbox.persistent,
    region: sandbox.region,
    vcpus: sandbox.vcpus,
    memory: sandbox.memory,
    runtime: sandbox.runtime,
    timeout: sandbox.timeout,
    networkPolicy: responseNetworkPolicy(sandbox.networkPolicy),
    createdAt: sandbox.createdAt,
    updatedAt: sandbox.updatedAt,
    currentSessionId: sandbox.sessionId,
    currentSnapshotId: sandbox.currentSnapshotId,
    status: session.status,
    statusUpdatedAt: sandbox.statusUpdatedAt,
    cwd: sandbox.cwd,
    tags: sandbox.tags,
    snapshotExpiration: sandbox.snapshotExpiration,
    keepLastSnapshots: sandbox.keepLastSnapshots,
  };
}

export function snapshotPayload(snapshot: SnapshotRecord) {
  return {
    id: snapshot.id,
    sourceSessionId: snapshot.sourceSessionId,
    region: snapshot.region,
    status: snapshot.status,
    sizeBytes: snapshot.sizeBytes,
    expiresAt: snapshot.expiresAt,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    parentId: snapshot.parentId,
  };
}

export function commandPayload(command: CommandRecord, opts?: { finished?: boolean }) {
  return {
    id: command.id,
    name: command.name,
    args: command.args,
    cwd: command.cwd,
    sessionId: command.sessionId,
    exitCode: opts?.finished ? (command.exitCode ?? 0) : command.exitCode,
    durationMs: command.durationMs,
    startedAt: command.startedAt,
  };
}
