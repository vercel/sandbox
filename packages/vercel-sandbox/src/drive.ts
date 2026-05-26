import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import type { WithFetchOptions } from "./api-client/api-client.js";
import type { DriveMetadata } from "./api-client/index.js";
import { APIClient } from "./api-client/index.js";
import { type Credentials, getCredentials } from "./utils/get-credentials.js";
import { attachPaginator } from "./utils/paginator.js";

export interface SerializedDrive {
  drive: DriveMetadata;
  projectId?: string;
}

/** @inline */
interface GetOrCreateDriveParams {
  /**
   * The name of the drive to get or create. Must be unique within the project.
   */
  name: string;
  /**
   * Maximum drive size in bytes. If omitted, a default of 100 GiB is used.
   */
  maxSize?: number;
  /**
   * An AbortSignal to cancel the operation.
   */
  signal?: AbortSignal;
}

/**
 * A Drive is a persistent, bottomless storage that can be attached and detached to Sandboxes.
 * Drives can be mounted as read-write or read-only, at a configurable path with `Sandbox.create()`.
 *
 * Use {@link Drive.getOrCreate} to construct.
 * @hideconstructor
 */
export class Drive {
  private _client: APIClient | null = null;
  private drive: DriveMetadata;
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
   * The name of the drive.
   */
  public get name(): string {
    return this.drive.name;
  }

  /**
   * The project ID that owns the drive.
   */
  public get projectId(): string {
    return this._projectId;
  }

  /**
   * The maximum drive size in bytes.
   */
  public get maxSize(): number {
    return this.drive.maxSizeBytes;
  }

  /**
   * Current session ID the drive is attached to, if any.
   */
  public get currentSessionId(): string | undefined {
    return this.drive.currentSessionId;
  }

  /**
   * Current sandbox name the drive is attached to, if any.
   */
  public get currentSandboxName(): string | undefined {
    return this.drive.currentSandboxName;
  }

  /**
   * Timestamp when the drive was created.
   */
  public get createdAt(): Date {
    return new Date(this.drive.createdAt);
  }

  /**
   * Timestamp when the drive was last updated.
   */
  public get updatedAt(): Date {
    return new Date(this.drive.updatedAt);
  }

  /**
   * Serialize a Drive instance to plain data for @workflow/serde.
   *
   * @param instance - The Drive instance to serialize
   * @returns A plain object containing drive metadata
   */
  static [WORKFLOW_SERIALIZE](instance: Drive): SerializedDrive {
    return {
      drive: instance.drive,
      projectId: instance._projectId,
    };
  }

  /**
   * Deserialize a Drive from serialized data.
   *
   * The deserialized instance uses the serialized metadata synchronously and
   * lazily creates an API client only when methods perform API requests.
   *
   * @param data - The serialized drive data
   * @returns The reconstructed Drive instance
   */
  static [WORKFLOW_DESERIALIZE](data: SerializedDrive): Drive {
    return new Drive({
      drive: data.drive,
      projectId: data.projectId,
    });
  }

  constructor({
    client,
    drive,
    projectId,
  }: {
    client?: APIClient;
    drive: DriveMetadata;
    projectId?: string;
  }) {
    this._client = client ?? null;
    this.drive = drive;
    this._projectId = projectId ?? drive.projectId;
  }

  /**
   * Allow to get a list of drives for a team narrowed to the given params.
   * It returns both the drives and the pagination metadata to allow getting
   * the next page of results.
   *
   * The returned object is async-iterable to auto-paginate through all pages:
   *
   * ```ts
   * const result = await Drive.list({ limit: 10 });
   * for await (const drive of result) { ... }
   * // or: await result.toArray();
   * // or: for await (const page of result.pages()) { ... }
   * ```
   */
  static async list(
    params?: Partial<Parameters<APIClient["listDrives"]>[0]> &
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
      const response = await client.listDrives({
        ...credentials,
        ...params,
        ...(cursor !== undefined && { cursor }),
      });
      return {
        ...response.json,
        drives: response.json.drives.map(
          (drive) =>
            new Drive({
              client,
              drive,
              projectId: credentials.projectId,
            }),
        ),
      };
    };
    const firstPage = await fetchPage(params?.cursor ?? params?.until);
    return attachPaginator(firstPage, {
      itemsKey: "drives",
      fetchNext: fetchPage,
      signal: params?.signal,
    });
  }

  /**
   * Retrieve an existing drive, or create a new one if it doesn't exists.
   *
   * @param params - Get/create parameters and optional credentials.
   * @returns A promise resolving to the {@link Drive}.
   */
  static async getOrCreate(
    params: (
      | GetOrCreateDriveParams
      | (GetOrCreateDriveParams & Credentials)
    ) &
      WithFetchOptions,
  ): Promise<Drive> {
    "use step";
    const credentials = await getCredentials(params);
    const client = new APIClient({
      teamId: credentials.teamId,
      token: credentials.token,
      fetch: params.fetch,
    });

    const response = await client.getOrCreateDrive({
      projectId: credentials.projectId,
      name: params.name,
      maxSizeBytes: params.maxSize,
      signal: params.signal,
    });

    return new Drive({
      client,
      drive: response.json.drive,
      projectId: credentials.projectId,
    });
  }

  /**
   * Delete this drive. The drive must not be attached to any sandbox.
   * This operation is irreversible and will delete all data stored in the drive.
   *
   * @param opts - Optional parameters.
   * @param opts.signal - An AbortSignal to cancel the operation.
   * @returns A promise that resolves once the drive has been deleted.
   */
  async delete(opts?: { signal?: AbortSignal }): Promise<void> {
    "use step";
    const client = await this.ensureClient();
    const response = await client.deleteDrive({
      projectId: this._projectId,
      name: this.drive.name,
      signal: opts?.signal,
    });

    this.drive = response.json.drive;
  }
}
