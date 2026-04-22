import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import type { WithFetchOptions } from "./api-client/api-client.js";
import type { SnapshotMetadata } from "./api-client/index.js";
import { APIClient } from "./api-client/index.js";
import { Sandbox } from "./sandbox.js";
import { type Credentials, getCredentials } from "./utils/get-credentials.js";

export interface SerializedSnapshot {
  snapshot: SnapshotMetadata;
}

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
  private _client: APIClient | null = null;

  /**
   * Lazily resolve credentials and construct an API client.
   * This is used in step contexts where the Snapshot was deserialized
   * without a client (e.g. when crossing workflow/step boundaries).
   * @internal
   */
  private async ensureClient(): Promise<APIClient> {
    "use step";
    if (this._client) return this._client;
    const credentials = await getCredentials();
    this._client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
    });
    return this._client;
  }

  /**
   * Unique ID of this snapshot.
   */
  public get snapshotId(): string {
    return this.snapshot.id;
  }

  /**
   * The ID of the session from which this snapshot was created.
   */
  public get sourceSessionId(): string {
    return this.snapshot.sourceSessionId;
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
   * The expiration date of this snapshot, or undefined if it does not expire.
   */
  public get expiresAt(): Date | undefined {
    if (this.snapshot.expiresAt === undefined) {
      return undefined;
    }

    return new Date(this.snapshot.expiresAt);
  }

  /**
   * Internal metadata about this snapshot.
   */
  private snapshot: SnapshotMetadata;

  /**
   * Serialize a Snapshot instance to plain data for @workflow/serde.
   *
   * @param instance - The Snapshot instance to serialize
   * @returns A plain object containing snapshot metadata
   */
  static [WORKFLOW_SERIALIZE](instance: Snapshot): SerializedSnapshot {
    return {
      snapshot: instance.snapshot,
    };
  }

  /**
   * Deserialize a Snapshot from serialized data.
   *
   * The deserialized instance uses the serialized metadata synchronously and
   * lazily creates an API client only when methods perform API requests.
   *
   * @param data - The serialized snapshot data
   * @returns The reconstructed Snapshot instance
   */
  static [WORKFLOW_DESERIALIZE](data: SerializedSnapshot): Snapshot {
    return new Snapshot({
      snapshot: data.snapshot,
    });
  }

  constructor({
    client,
    snapshot,
  }: {
    client?: APIClient;
    snapshot: SnapshotMetadata;
  }) {
    this._client = client ?? null;
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
    "use step";
    const credentials = await getCredentials(params);
    const client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
      fetch: params?.fetch,
    });
    const response = await client.listSnapshots({
      ...credentials,
      ...params,
    });
    return response.json;
  }

  /**
   * Resolve the current snapshot ID of an existing sandbox by name.
   *
   * Useful to feed into {@link Sandbox.create} as `source.snapshotId` without
   * having to first look up the sandbox yourself.
   *
   * @param name - The name of the source sandbox.
   * @param opts - Optional credentials, fetch override, and abort signal.
   * @returns The current snapshot ID of the named sandbox.
   * @throws If the sandbox has no current snapshot.
   *
   * @example
   * const sandbox = await Sandbox.create({
   *   source: {
   *     type: "snapshot",
   *     snapshotId: await Snapshot.fromSandbox("my-sandbox"),
   *   },
   * });
   */
  static async fromSandbox(
    name: string,
    opts?: Partial<Credentials> & WithFetchOptions & { signal?: AbortSignal },
  ): Promise<string> {
    "use step";
    const sandbox = await Sandbox.get({
      name,
      resume: false,
      signal: opts?.signal,
      fetch: opts?.fetch,
      teamId: opts?.teamId,
      projectId: opts?.projectId,
      token: opts?.token,
    });
    if (!sandbox.currentSnapshotId) {
      throw new Error(`Sandbox "${name}" has no current snapshot.`);
    }
    return sandbox.currentSnapshotId;
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
    "use step";
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
    "use step";
    const client = await this.ensureClient();
    const response = await client.deleteSnapshot({
      snapshotId: this.snapshot.id,
      signal: opts?.signal,
    });

    this.snapshot = response.json.snapshot;
  }
}
