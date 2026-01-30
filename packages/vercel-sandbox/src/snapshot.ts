import type { SnapshotMetadata } from "./api-client";
import { APIClient } from "./api-client";
import { WithFetchOptions } from "./api-client/api-client";
import { Credentials, getCredentials } from "./utils/get-credentials";

/** @inline */
interface GetSnapshotParams {
  /**
   * Unique identifier of the snapshot.
   */
  snapshotId: string;
  /**
   * An AbortSignal to cancel the operation.
   */
  signal?: AbortSignal;
}

/**
 * A Snapshot is a saved state of a Sandbox that can be used to create new Sandboxes
 *
 * Use {@link Sandbox.snapshot} or {@link Snapshot.get} to construct.
 * @hideconstructor
 */
export class Snapshot {
  private readonly client: APIClient;

  /**
   * Unique ID of this snapshot.
   */
  public get snapshotId(): string {
    return this.snapshot.id;
  }

  /**
   * The ID the sandbox from which this snapshot was created.
   */
  public get sourceSandboxId(): string {
    return this.snapshot.sourceSandboxId;
  }

  /**
   * The status of the snapshot.
   */
  public get status(): SnapshotMetadata["status"] {
    return this.snapshot.status;
  }

  /**
   * The size of the snapshot in bytes, or null if not available.
   */
  public get sizeBytes(): number {
    return this.snapshot.sizeBytes;
  }

  /**
   * The creation date of this snapshot.
   */
  public get createdAt(): Date {
    return new Date(this.snapshot.createdAt);
  }

  /**
   * The expiration date of this snapshot.
   */
  public get expiresAt(): Date {
    return new Date(this.snapshot.expiresAt);
  }

  /**
   * Internal metadata about this snapshot.
   */
  private snapshot: SnapshotMetadata;

  /**
   * Create a new Snapshot instance.
   *
   * @param client - API client used to communicate with the backend
   * @param snapshot - Snapshot metadata
   */
  constructor({
    client,
    snapshot,
  }: {
    client: APIClient;
    snapshot: SnapshotMetadata;
  }) {
    this.client = client;
    this.snapshot = snapshot;
  }

  /**
   * Allow to get a list of snapshots for a team narrowed to the given params.
   * It returns both the snapshots and the pagination metadata to allow getting
   * the next page of results.
   */
  static async list(
    params?: Partial<Parameters<APIClient["listSnapshots"]>[0]> &
      Partial<Credentials> &
      WithFetchOptions,
  ) {
    const credentials = await getCredentials(params);
    const client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
      fetch: params?.fetch,
    });
    return client.listSnapshots({
      ...credentials,
      ...params,
    });
  }

  /**
   * Retrieve an existing snapshot.
   *
   * @param params - Get parameters and optional credentials.
   * @returns A promise resolving to the {@link Sandbox}.
   */
  static async get(
    params: GetSnapshotParams | (GetSnapshotParams & Credentials),
  ): Promise<Snapshot> {
    const credentials = await getCredentials(params);
    const client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
    });

    const sandbox = await client.getSnapshot({
      snapshotId: params.snapshotId,
      signal: params.signal,
    });

    return new Snapshot({
      client,
      snapshot: sandbox.json.snapshot,
    });
  }

  /**
   * Delete this snapshot.
   *
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves once the snapshot has been deleted.
   */
  async delete(opts?: { signal?: AbortSignal }): Promise<void> {
    const response = await this.client.deleteSnapshot({
      snapshotId: this.snapshot.id,
      signal: opts?.signal,
    });

    this.snapshot = response.json.snapshot;
  }
}
