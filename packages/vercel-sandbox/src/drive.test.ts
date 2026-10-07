import { describe, expect, it, vi } from "vitest";
import { Drive } from "./drive.js";
import { APIError } from "./api-client/api-error.js";

const CREDENTIALS = {
  token: "test-token",
  teamId: "team_123",
  projectId: "proj_123",
};

const drivePayload = {
  id: "drive_123",
  name: "workspace",
  projectId: "proj_123",
  region: "sfo1",
  maxSizeBytes: 1024,
  currentSessionId: "sbx_123",
  currentSandboxName: "my-sandbox",
  createdAt: 1,
  updatedAt: 2,
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("Drive", () => {
  it("creates a snapshot mount without changing the drive", () => {
    const drive = new Drive({ drive: drivePayload });
    expect(drive.snapshot()).toEqual({ drive: "workspace", mode: "snapshot" });
    expect(drive.name).toBe("workspace");
    expect(drive).not.toHaveProperty("mode");
    expect(drive.parentDriveId).toBeUndefined();
    expect(drive.rootDriveId).toBeUndefined();
  });

  it("forks a drive and reuses its client without changing the source", async () => {
    const forkPayload = {
      ...drivePayload,
      id: "drive_fork",
      name: "workspace-fork",
      parentDriveId: "drive_123",
      rootDriveId: "drive_root",
      currentSessionId: undefined,
      currentSandboxName: undefined,
    };
    const mockFetch = vi.fn<typeof fetch>(async (_input, init) =>
      jsonResponse({
        drive: init?.method === "GET" ? drivePayload : forkPayload,
      }),
    );
    const drive = await Drive.get({
      ...CREDENTIALS,
      name: "workspace",
      fetch: mockFetch,
    });
    const signal = new AbortController().signal;

    const forkedDrive = await drive.fork({ name: "workspace-fork", signal });

    expect(forkedDrive).toBeInstanceOf(Drive);
    expect(forkedDrive.driveId).toBe("drive_fork");
    expect(forkedDrive.name).toBe("workspace-fork");
    expect(forkedDrive.parentDriveId).toBe("drive_123");
    expect(forkedDrive.rootDriveId).toBe("drive_root");
    expect(forkedDrive.projectId).toBe("proj_123");
    expect(forkedDrive.region).toBe(drive.region);
    expect(forkedDrive.maxSize).toBe(drive.maxSize);
    expect(forkedDrive.currentSessionId).toBeUndefined();
    expect(drive.driveId).toBe("drive_123");
    expect(drive.name).toBe("workspace");
    expect(drive.parentDriveId).toBeUndefined();
    expect(drive.currentSessionId).toBe("sbx_123");

    const [url, init] = mockFetch.mock.calls[1];
    const requestUrl = new URL(String(url));
    expect(requestUrl.pathname).toBe("/api/v2/sandboxes/drives/workspace/fork");
    expect(requestUrl.searchParams.get("teamId")).toBe("team_123");
    expect(requestUrl.searchParams.get("projectId")).toBe("proj_123");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-token",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "workspace-fork" });
    expect(init?.signal).toBe(signal);

    await forkedDrive.delete();

    const [deleteUrl, deleteInit] = mockFetch.mock.calls[2];
    expect(new URL(String(deleteUrl)).pathname).toBe(
      "/api/v2/sandboxes/drives/workspace-fork",
    );
    expect(deleteInit?.method).toBe("DELETE");
  });

  it.each([
    { status: 404, code: "not_found", message: "Drive not found." },
    {
      status: 409,
      code: "conflict",
      message: 'Drive "workspace-fork" already exists.',
    },
    {
      status: 409,
      code: "drive_not_initialized",
      message:
        "The source drive has no committed data. Mount it as read-write first.",
    },
  ])(
    "preserves fork errors with code $code",
    async ({ status, code, message }) => {
      const mockFetch = vi.fn<typeof fetch>(async (_input, init) =>
        init?.method === "GET"
          ? jsonResponse({ drive: drivePayload })
          : new Response(JSON.stringify({ error: { code, message } }), {
              status,
              headers: { "content-type": "application/json" },
            }),
      );
      const drive = await Drive.get({
        ...CREDENTIALS,
        name: "workspace",
        fetch: mockFetch,
      });

      const result = drive.fork({ name: "workspace-fork" });

      await expect(result).rejects.toBeInstanceOf(APIError);
      await expect(result).rejects.toMatchObject({
        response: { status },
        json: { error: { code, message } },
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(drive.name).toBe("workspace");
    },
  );

  it("gets a drive by name", async () => {
    const mockFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ drive: drivePayload }),
    );
    const signal = new AbortController().signal;

    const drive = await Drive.get({
      ...CREDENTIALS,
      name: "workspace",
      signal,
      fetch: mockFetch,
    });

    expect(drive).toBeInstanceOf(Drive);
    expect(drive.driveId).toBe("drive_123");
    expect(drive.name).toBe("workspace");
    expect(drive.projectId).toBe("proj_123");
    expect(drive.region).toBe("sfo1");
    expect(drive.maxSize).toBe(1024);
    expect(drive.currentSessionId).toBe("sbx_123");
    expect(drive.currentSandboxName).toBe("my-sandbox");
    expect(drive.createdAt).toEqual(new Date(1));
    expect(drive.updatedAt).toEqual(new Date(2));

    const [url, init] = mockFetch.mock.calls[0];
    const requestUrl = new URL(String(url));
    expect(requestUrl.pathname).toBe("/api/v2/sandboxes/drives/workspace");
    expect(requestUrl.searchParams.get("teamId")).toBe("team_123");
    expect(requestUrl.searchParams.get("projectId")).toBe("proj_123");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-token",
    );
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.signal).toBe(signal);
  });

  it("throws an APIError for a missing drive without creating it", async () => {
    const mockFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "not_found", message: "Drive not found." },
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        ),
    );

    const result = Drive.get({
      ...CREDENTIALS,
      name: "missing",
      fetch: mockFetch,
    });

    await expect(result).rejects.toBeInstanceOf(APIError);
    await expect(result).rejects.toMatchObject({
      response: { status: 404 },
      json: { error: { code: "not_found" } },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1]?.method).toBe("GET");
  });

  it("uses the same client to delete a fetched drive", async () => {
    const mockFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ drive: drivePayload }),
    );
    const drive = await Drive.get({
      ...CREDENTIALS,
      name: "workspace",
      fetch: mockFetch,
    });

    await drive.delete();

    const [url, init] = mockFetch.mock.calls[1];
    expect(new URL(String(url)).pathname).toBe(
      "/api/v2/sandboxes/drives/workspace",
    );
    expect(init?.method).toBe("DELETE");
  });

  it("gets or creates a drive", async () => {
    const mockFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ drive: drivePayload }),
    );

    const drive = await Drive.getOrCreate({
      ...CREDENTIALS,
      name: "workspace",
      region: "sfo1",
      maxSize: 1024,
      fetch: mockFetch,
    });

    expect(drive.driveId).toBe("drive_123");
    expect(drive.name).toBe("workspace");
    expect(drive.projectId).toBe("proj_123");
    expect(drive.region).toBe("sfo1");
    expect(drive.maxSize).toBe(1024);
    expect(drive.currentSessionId).toBe("sbx_123");
    expect(drive.currentSandboxName).toBe("my-sandbox");
    expect(drive.createdAt).toEqual(new Date(1));

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/v2/sandboxes/drives/workspace");
    expect(String(url)).toContain("teamId=team_123");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      projectId: "proj_123",
      region: "sfo1",
      maxSizeBytes: 1024,
    });
  });

  it("lists drives with pagination", async () => {
    const mockFetch = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("cursor=next-page")) {
        return jsonResponse({
          drives: [{ ...drivePayload, name: "cache" }],
          pagination: { count: 1, next: null },
        });
      }

      return jsonResponse({
        drives: [drivePayload],
        pagination: { count: 1, next: "next-page" },
      });
    });

    const result = await Drive.list({
      ...CREDENTIALS,
      limit: 1,
      fetch: mockFetch,
    });

    expect(result.drives[0]).toBeInstanceOf(Drive);
    expect(result.drives[0].driveId).toBe("drive_123");
    expect(result.drives[0].name).toBe("workspace");
    expect(result.drives[0].region).toBe("sfo1");
    await expect(result.toArray()).resolves.toEqual([
      expect.objectContaining({ name: "workspace" }),
      expect.objectContaining({ name: "cache" }),
    ]);
  });

  it("deletes a drive", async () => {
    const mockFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        drive: { ...drivePayload, currentSessionId: undefined },
      }),
    );
    const drive = await Drive.getOrCreate({
      ...CREDENTIALS,
      name: "workspace",
      fetch: mockFetch,
    });

    await drive.delete();

    const [url, init] = mockFetch.mock.calls[1];
    expect(String(url)).toContain("/v2/sandboxes/drives/workspace");
    expect(String(url)).toContain("projectId=proj_123");
    expect(init?.method).toBe("DELETE");
  });
});
