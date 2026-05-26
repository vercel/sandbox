import { describe, expect, it, vi } from "vitest";
import { Drive } from "./drive.js";

const CREDENTIALS = {
  token: "test-token",
  teamId: "team_123",
  projectId: "proj_123",
};

const drivePayload = {
  name: "workspace",
  projectId: "proj_123",
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
  it("gets or creates a drive", async () => {
    const mockFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ drive: drivePayload }),
    );

    const drive = await Drive.getOrCreate({
      ...CREDENTIALS,
      name: "workspace",
      maxSize: 1024,
      fetch: mockFetch,
    });

    expect(drive.name).toBe("workspace");
    expect(drive.projectId).toBe("proj_123");
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
    expect(result.drives[0].name).toBe("workspace");
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
