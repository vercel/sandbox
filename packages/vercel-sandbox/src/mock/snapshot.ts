/**
 * In-memory mock of the Snapshot class for testing.
 * All state is stored locally — no API calls are made.
 */

interface MockSnapshotOptions {
  snapshotId?: string;
  sourceSandboxId?: string;
  status?: "created" | "deleted" | "failed";
  sizeBytes?: number;
  createdAt?: Date;
  expiresAt?: Date;
}

export class MockSnapshot {
  private _snapshotId: string;
  private _sourceSandboxId: string;
  private _status: "created" | "deleted" | "failed";
  private _sizeBytes: number;
  private _createdAt: Date;
  private _expiresAt: Date | undefined;

  constructor(options?: MockSnapshotOptions) {
    this._snapshotId = options?.snapshotId ?? `snap_${Math.random().toString(36).slice(2)}`;
    this._sourceSandboxId = options?.sourceSandboxId ?? `sbx_${Math.random().toString(36).slice(2)}`;
    this._status = options?.status ?? "created";
    this._sizeBytes = options?.sizeBytes ?? 0;
    this._createdAt = options?.createdAt ?? new Date();
    this._expiresAt = options?.expiresAt;
  }

  get snapshotId(): string {
    return this._snapshotId;
  }

  get sourceSandboxId(): string {
    return this._sourceSandboxId;
  }

  get status(): "created" | "deleted" | "failed" {
    return this._status;
  }

  get sizeBytes(): number {
    return this._sizeBytes;
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  get expiresAt(): Date | undefined {
    if (this._expiresAt === undefined) {
      return undefined;
    }
    return new Date(this._expiresAt);
  }

  async delete(): Promise<void> {
    this._status = "deleted";
  }

  static async get(params?: { snapshot?: MockSnapshotOptions }): Promise<MockSnapshot> {
    return new MockSnapshot(params?.snapshot);
  }

  static async list(params?: {
    snapshots?: MockSnapshotOptions[];
  }): Promise<{
    snapshots: MockSnapshot[];
    pagination: { count: number; next: number | null; prev: number | null };
  }> {
    const snapshots = (params?.snapshots ?? []).map((opts) => new MockSnapshot(opts));
    return {
      snapshots,
      pagination: {
        count: snapshots.length,
        next: null,
        prev: null,
      },
    };
  }
}
