import type { Snapshot as RealSnapshot } from "@vercel/sandbox";
import { createPaginator } from "./paginator";
import type { MockPaginator } from "./paginator";
import type { PublicShape, AssertExtends } from "./type-utils";

type SnapshotMetadata = Awaited<ReturnType<typeof RealSnapshot.list>>["snapshots"][number];
type SnapshotTreeResult = Awaited<ReturnType<typeof RealSnapshot.tree>>;
type SnapshotListParams = NonNullable<Parameters<typeof RealSnapshot.list>[0]> & {
  snapshots?: { snapshotId?: string; sourceSessionId?: string }[];
};

export type SnapshotFileSystemEntry =
  | { path: string; mode: number; type: "directory" }
  | { path: string; mode: number; type: "file"; content: Buffer }
  | { path: string; type: "symlink"; target: string };

type SnapshotRecord = {
  snapshot: Snapshot;
  sandboxName?: string;
  fileSystem?: SnapshotFileSystemEntry[];
};

const snapshots = new Map<string, SnapshotRecord>();

function snapshotToMetadata(snapshot: Snapshot): SnapshotMetadata {
  return {
    id: snapshot.snapshotId,
    sourceSessionId: snapshot.sourceSessionId,
    region: "mock",
    status: snapshot.status,
    sizeBytes: snapshot.sizeBytes,
    createdAt: snapshot.createdAt.getTime(),
    updatedAt: snapshot.updatedAt.getTime(),
    expiresAt: snapshot.expiresAt?.getTime(),
  };
}

export function registerSnapshot(
  snapshot: Snapshot,
  sandboxName?: string,
  fileSystem?: SnapshotFileSystemEntry[],
): void {
  snapshots.set(snapshot.snapshotId, { snapshot, sandboxName, fileSystem });
}

export function getSnapshotFileSystem(snapshotId: string): SnapshotFileSystemEntry[] | undefined {
  return snapshots.get(snapshotId)?.fileSystem;
}

export function listSnapshotMetadata(sandboxName?: string): SnapshotMetadata[] {
  return [...snapshots.values()]
    .filter((record) => sandboxName === undefined || record.sandboxName === sandboxName)
    .map(({ snapshot }) => snapshotToMetadata(snapshot));
}

export function resetSnapshots(): void {
  snapshots.clear();
}

/**
 * A saved local session state that can be used to create new sandboxes.
 */
export class Snapshot {
  readonly snapshotId: string;
  readonly sourceSessionId: string;
  status: "created" | "deleted" | "failed" = "created";
  readonly sizeBytes: number = 0;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date | undefined = undefined;

  constructor(snapshotId = "mock-snapshot", sourceSessionId = "mock-session") {
    this.snapshotId = snapshotId;
    this.sourceSessionId = sourceSessionId;
    this.createdAt = new Date();
    this.updatedAt = this.createdAt;
  }

  static async list(
    params?: SnapshotListParams,
  ): Promise<MockPaginator<"snapshots", SnapshotMetadata>> {
    for (const opts of params?.snapshots ?? []) {
      const snapshot = new Snapshot(opts.snapshotId, opts.sourceSessionId);
      registerSnapshot(snapshot, params?.name);
    }
    return createPaginator("snapshots", listSnapshotMetadata(params?.name));
  }

  static async tree(params: Parameters<typeof RealSnapshot.tree>[0]): Promise<SnapshotTreeResult> {
    const snapshot = snapshotToMetadata(
      snapshots.get(params.snapshotId)?.snapshot ?? new Snapshot(params.snapshotId),
    );
    const anchor: SnapshotTreeResult["snapshots"][number] = {
      snapshot,
      siblings: [],
      count: "1",
    };
    return Object.assign(createPaginator("snapshots", [anchor]), { anchor });
  }

  static async get(params?: { snapshotId?: string; sourceSessionId?: string }): Promise<Snapshot> {
    const snapshot = params?.snapshotId ? snapshots.get(params.snapshotId)?.snapshot : undefined;
    if (snapshot) return snapshot;
    throw new APIError(new Response(null, { status: 404, statusText: "Not Found" }), {
      message: `Snapshot not found: ${params?.snapshotId ?? "unknown"}`,
    });
  }

  async delete(_opts?: { signal?: AbortSignal }): Promise<void> {
    this.status = "deleted";
    const record = snapshots.get(this.snapshotId);
    if (record) record.fileSystem = undefined;
  }
}

/* eslint-disable no-unused-expressions */
null! as AssertExtends<PublicShape<Snapshot>, PublicShape<RealSnapshot>>;
/* eslint-enable no-unused-expressions */

/**
 * Error thrown when an API request fails.
 * Constructor signature matches the real @vercel/sandbox APIError.
 */
export class APIError<ErrorData = unknown> extends Error {
  readonly response: Response;
  readonly json: ErrorData | undefined;
  readonly text: string | undefined;
  readonly sandboxId: string | undefined;

  constructor(
    response: Response,
    options?: {
      message?: string;
      json?: ErrorData;
      text?: string;
      sandboxId?: string;
    },
  ) {
    super(options?.message ?? response.statusText ?? "API Error");
    this.name = "APIError";
    this.response = response;
    this.json = options?.json;
    this.text = options?.text;
    this.sandboxId = options?.sandboxId;
  }
}

/**
 * Error thrown when a stream error is received while streaming.
 * This typically occurs when the sandbox is stopped while streaming.
 */
export class StreamError extends Error {
  readonly code: string;
  readonly sessionId: string;
  /** @deprecated Use sessionId. */
  readonly sandboxId: string;

  constructor(code: string, message: string, sessionId: string) {
    super(message);
    this.name = "StreamError";
    this.code = code;
    this.sessionId = sessionId;
    this.sandboxId = sessionId;
  }
}
