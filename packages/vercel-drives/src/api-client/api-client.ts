import { AuthenticatedClient } from "../../../shared/src/api-client/authenticated-client.js";
import { sdkConfig } from "../config.js";
import { parseOrThrow } from "./base-client.js";
import { APIError } from "./api-error.js";
import { DrivesResponse, DriveResponse } from "./validators.js";

export interface WithFetchOptions {
  fetch?: typeof globalThis.fetch;
}

export class APIClient extends AuthenticatedClient {
  constructor(params: {
    baseUrl?: string;
    teamId: string;
    token: string;
    fetch?: typeof globalThis.fetch;
  }) {
    super({ ...params, config: sdkConfig, apiError: APIError });
  }

  async listDrives(params: {
    projectId: string;
    limit?: number;
    cursor?: string;
    sortBy?: "createdAt" | "updatedAt" | "name";
    sortOrder?: "asc" | "desc";
    namePrefix?: string;
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      DrivesResponse,
      await this.request(`/v2/sandboxes/drives`, {
        query: {
          projectId: params.projectId,
          limit: params.limit,
          cursor: params.cursor,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
          namePrefix: params.namePrefix,
        },
        method: "GET",
        signal: params.signal,
      }),
    );
  }

  async getDrive(params: {
    projectId: string;
    name: string;
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      DriveResponse,
      await this.request(
        `/v2/sandboxes/drives/${encodeURIComponent(params.name)}`,
        {
          method: "GET",
          query: { projectId: params.projectId },
          signal: params.signal,
        },
      ),
    );
  }

  async getOrCreateDrive(params: {
    projectId: string;
    name: string;
    region?: string;
    maxSizeBytes?: number;
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      DriveResponse,
      await this.request(
        `/v2/sandboxes/drives/${encodeURIComponent(params.name)}`,
        {
          method: "POST",
          body: JSON.stringify({
            projectId: params.projectId,
            region: params.region,
            maxSizeBytes: params.maxSizeBytes,
          }),
          signal: params.signal,
        },
      ),
    );
  }

  async forkDrive(params: {
    projectId: string;
    name: string;
    forkName: string;
    signal?: AbortSignal;
  }) {
    return parseOrThrow(
      DriveResponse,
      await this.request(
        `/v2/sandboxes/drives/${encodeURIComponent(params.name)}/fork`,
        {
          method: "POST",
          query: { projectId: params.projectId },
          body: JSON.stringify({ name: params.forkName }),
          signal: params.signal,
        },
      ),
    );
  }

  async deleteDrive(params: {
    projectId: string;
    name: string;
    signal?: AbortSignal;
  }) {
    const url = `/v2/sandboxes/drives/${encodeURIComponent(params.name)}`;
    return parseOrThrow(
      DriveResponse,
      await this.request(url, {
        method: "DELETE",
        query: {
          projectId: params.projectId,
        },
        signal: params.signal,
      }),
    );
  }
}
