import type { Executor } from "./executor.js";

/** Session lifecycle states, mirroring the SDK's `Session.status` enum. */
export type SessionStatus =
  | "pending"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "aborted"
  | "snapshotting";

/**
 * In-memory simulation of the sandbox's Linux users and groups. just-bash has
 * no real user system, so `useradd`/`groupadd`/`id`/... (see `user-commands`)
 * read and mutate this state instead. Shared by every session of a sandbox.
 */
export interface UserState {
  /** The user non-`sudo` commands run as (what `id -un` reports). */
  defaultUser: string;
  /** The default user's primary group (what `id -gn` reports). */
  defaultGroup: string;
  /** Created users → their primary group. */
  users: Map<string, { group: string }>;
  /** Groups → the set of member usernames. */
  groups: Map<string, Set<string>>;
}

export function createUserState(): UserState {
  return {
    defaultUser: "vercel-sandbox",
    defaultGroup: "vercel-sandbox",
    users: new Map(),
    groups: new Map(),
  };
}

export interface SessionRecord {
  id: string;
  sandboxName: string;
  status: SessionStatus;
  timeout: number;
  networkPolicy?: unknown;
  memory: number;
  vcpus: number;
  region: string;
  runtime: string;
  cwd: string;
  sourceSnapshotId?: string;
  interactivePort?: number;
  createdAt: number;
  requestedAt: number;
  startedAt?: number;
  updatedAt: number;
  stoppedAt?: number;
  requestedStopAt?: number;
  snapshottedAt?: number;
  duration?: number;
  activeCpuDurationMs?: number;
  networkTransfer?: { ingress: number; egress: number };
  executor: Executor;
}

export interface SandboxRecord {
  name: string;
  persistent: boolean;
  region: string;
  vcpus: number;
  memory: number;
  runtime: string;
  timeout: number;
  tags?: Record<string, string>;
  networkPolicy?: unknown;
  cwd: string;
  env?: Record<string, string>;
  ports: number[];
  createdAt: number;
  updatedAt: number;
  statusUpdatedAt?: number;
  currentSnapshotId?: string;
  sourceSnapshotId?: string;
  snapshotExpiration?: number;
  keepLastSnapshots?: {
    count: number;
    expiration?: number;
    deleteEvicted?: boolean;
  };
  sessionId: string;
  users: UserState;
}

export interface SnapshotRecord {
  id: string;
  sandboxName: string;
  sourceSessionId: string;
  region: string;
  status: "created" | "deleted" | "failed";
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  parentId?: string;
  /** Captured filesystem, restored when a sandbox is created from this snapshot. */
  files: SnapshotFileEntry[];
}

export type SnapshotFileEntry =
  | { path: string; type: "directory"; mode: number }
  | { path: string; type: "symlink"; target: string }
  | { path: string; type: "file"; mode: number; content: Buffer };

export interface CommandRecord {
  id: string;
  sessionId: string;
  name: string;
  args: string[];
  cwd: string;
  startedAt: number;
  exitCode: number | null;
  durationMs?: number;
  stdout: string;
  stderr: string;
}
