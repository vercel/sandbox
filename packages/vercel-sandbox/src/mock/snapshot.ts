import type { SnapshotMetadata, PaginationData } from "../api-client/validators.js";

type SnapshotStatus = SnapshotMetadata["status"];

export class MockSnapshot {
  readonly snapshotId: string;
  readonly sourceSandboxId: string;
  status: SnapshotStatus;
  readonly sizeBytes: number;
  readonly createdAt: Date;
  readonly expiresAt: Date | undefined;

  constructor(opts?: {
    snapshotId?: string;
    sourceSandboxId?: string;
    status?: SnapshotStatus;
    sizeBytes?: number;
    createdAt?: Date;
    expiresAt?: Date;
  }) {
    this.snapshotId = opts?.snapshotId ?? `snap_${Math.random().toString(36).slice(2)}`;
    this.sourceSandboxId = opts?.sourceSandboxId ?? `sbx_${Math.random().toString(36).slice(2)}`;
    this.status = opts?.status ?? "created";
    this.sizeBytes = opts?.sizeBytes ?? 0;
    this.createdAt = opts?.createdAt ?? new Date();
    this.expiresAt = opts?.expiresAt;
  }

  async delete(): Promise<void> {
    this.status = "deleted";
  }

  static async get(params?: {
    snapshot?: ConstructorParameters<typeof MockSnapshot>[0];
  }): Promise<MockSnapshot> {
    return new MockSnapshot(params?.snapshot);
  }

  static async list(params?: {
    snapshots?: ConstructorParameters<typeof MockSnapshot>[0][];
  }): Promise<{ snapshots: MockSnapshot[]; pagination: PaginationData }> {
    const snapshots = (params?.snapshots ?? []).map((opts) => new MockSnapshot(opts));
    return {
      snapshots,
      pagination: { count: snapshots.length, next: null, prev: null },
    };
  }
}
