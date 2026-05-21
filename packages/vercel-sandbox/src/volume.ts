import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import type { WithFetchOptions } from "./api-client/api-client.js";
import type { VolumeMetadata } from "./api-client/index.js";
import { APIClient } from "./api-client/index.js";
import { type Credentials, getCredentials } from "./utils/get-credentials.js";
import { attachPaginator } from "./utils/paginator.js";

export interface SerializedVolume {
  volume: VolumeMetadata;
  projectId?: string;
}

/** @inline */
interface GetOrCreateVolumeParams {
  /**
   * The name of the volume to get or create. Must be unique within the project.
   */
  name: string;
  /**
   * Maximum volume size in bytes. If omitted, a default of 100 GiB is used.
   */
  maxSize?: number;
  /**
   * An AbortSignal to cancel the operation.
   */
  signal?: AbortSignal;
}

/**
 * A Volume is a persistent, bottomless storage that can be attached and detached to Sandboxes.
 * Volumes can be mounted as read-write or read-only, at a configurable path with `Sandbox.create()`.
 *
 * Use {@link Volume.getOrCreate} to construct.
 * @hideconstructor
 */
export class Volume {
  private _client: APIClient | null = null;
  private volume: VolumeMetadata;
  private readonly _projectId: string;

  /**
   * Lazily resolve credentials and construct an API client.
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
   * The name of the volume.
   */
  public get name(): string {
    return this.volume.name;
  }

  /**
   * The project ID that owns the volume.
   */
  public get projectId(): string {
    return this._projectId;
  }

  /**
   * The maximum volume size in bytes.
   */
  public get maxSize(): number {
    return this.volume.maxSizeBytes;
  }

  /**
   * Current session ID the volume is attached to, if any.
   */
  public get currentSessionId(): string | undefined {
    return this.volume.currentSessionId;
  }

  /**
   * Current sandbox name the volume is attached to, if any.
   */
  public get currentSandboxName(): string | undefined {
    return this.volume.currentSandboxName;
  }

  /**
   * Timestamp when the volume was created.
   */
  public get createdAt(): Date {
    return new Date(this.volume.createdAt);
  }

  /**
   * Timestamp when the volume was last updated.
   */
  public get updatedAt(): Date {
    return new Date(this.volume.updatedAt);
  }

  /**
   * Serialize a Volume instance to plain data for @workflow/serde.
   *
   * @param instance - The Volume instance to serialize
   * @returns A plain object containing volume metadata
   */
  static [WORKFLOW_SERIALIZE](instance: Volume): SerializedVolume {
    return {
      volume: instance.volume,
      projectId: instance._projectId,
    };
  }

  /**
   * Deserialize a Volume from serialized data.
   *
   * The deserialized instance uses the serialized metadata synchronously and
   * lazily creates an API client only when methods perform API requests.
   *
   * @param data - The serialized volume data
   * @returns The reconstructed Volume instance
   */
  static [WORKFLOW_DESERIALIZE](data: SerializedVolume): Volume {
    return new Volume({
      volume: data.volume,
      projectId: data.projectId,
    });
  }

  constructor({
    client,
    volume,
    projectId,
  }: {
    client?: APIClient;
    volume: VolumeMetadata;
    projectId?: string;
  }) {
    this._client = client ?? null;
    this.volume = volume;
    this._projectId = projectId ?? volume.projectId;
  }

  /**
   * Allow to get a list of volumes for a team narrowed to the given params.
   * It returns both the volumes and the pagination metadata to allow getting
   * the next page of results.
   *
   * The returned object is async-iterable to auto-paginate through all pages:
   *
   * ```ts
   * const result = await Volume.list({ limit: 10 });
   * for await (const volume of result) { ... }
   * // or: await result.toArray();
   * // or: for await (const page of result.pages()) { ... }
   * ```
   */
  static async list(
    params?: Partial<Parameters<APIClient["listVolumes"]>[0]> &
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
    const fetchPage = async (cursor?: string | number) => {
      const response = await client.listVolumes({
        ...credentials,
        ...params,
        ...(cursor !== undefined && { cursor }),
      });
      return {
        ...response.json,
        volumes: response.json.volumes.map(
          (volume) =>
            new Volume({
              client,
              volume,
              projectId: credentials.projectId,
            }),
        ),
      };
    };
    const firstPage = await fetchPage(params?.cursor ?? params?.until);
    return attachPaginator(firstPage, {
      itemsKey: "volumes",
      fetchNext: fetchPage,
      signal: params?.signal,
    });
  }

  /**
   * Retrieve an existing volume, or create a new one if it doesn't exists.
   *
   * @param params - Get/create parameters and optional credentials.
   * @returns A promise resolving to the {@link Volume}.
   */
  static async getOrCreate(
    params: (
      | GetOrCreateVolumeParams
      | (GetOrCreateVolumeParams & Credentials)
    ) &
      WithFetchOptions,
  ): Promise<Volume> {
    "use step";
    const credentials = await getCredentials(params);
    const client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
      fetch: params.fetch,
    });

    const response = await client.getOrCreateVolume({
      projectId: credentials.projectId,
      name: params.name,
      maxSizeBytes: params.maxSize,
      signal: params.signal,
    });

    return new Volume({
      client,
      volume: response.json.volume,
      projectId: credentials.projectId,
    });
  }

  /**
   * Delete this volume. The volume must not be attached to any sandbox.
   * This operation is irreversible and will delete all data stored in the volume.
   *
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves once the volume has been deleted.
   */
  async delete(opts?: { signal?: AbortSignal }): Promise<void> {
    "use step";
    const client = await this.ensureClient();
    const response = await client.deleteVolume({
      projectId: this._projectId,
      name: this.volume.name,
      signal: opts?.signal,
    });

    this.volume = response.json.volume;
  }
}
