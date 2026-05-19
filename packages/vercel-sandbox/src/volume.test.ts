import { describe, expect, it, vi } from "vitest";
import { Volume } from "./volume.js";

const CREDENTIALS = {
  token: "test-token",
  teamId: "team_123",
  projectId: "proj_123",
};

const volumePayload = {
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

describe("Volume", () => {
  it("gets or creates a volume", async () => {
    const mockFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ volume: volumePayload }),
    );

    const volume = await Volume.getOrCreate({
      ...CREDENTIALS,
      name: "workspace",
      maxSize: 1024,
      fetch: mockFetch,
    });

    expect(volume.name).toBe("workspace");
    expect(volume.projectId).toBe("proj_123");
    expect(volume.project).toBe("proj_123");
    expect(volume.maxSize).toBe(1024);
    expect(volume.currentSessionId).toBe("sbx_123");
    expect(volume.currentSandboxName).toBe("my-sandbox");
    expect(volume.createdAt).toEqual(new Date(1));

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/v2/sandboxes/volumes/workspace");
    expect(String(url)).toContain("teamId=team_123");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      projectId: "proj_123",
      maxSizeBytes: 1024,
    });
  });

  it("lists volumes with pagination", async () => {
    const mockFetch = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("cursor=next-page")) {
        return jsonResponse({
          volumes: [{ ...volumePayload, name: "cache" }],
          pagination: { count: 1, next: null },
        });
      }

      return jsonResponse({
        volumes: [volumePayload],
        pagination: { count: 1, next: "next-page" },
      });
    });

    const result = await Volume.list({
      ...CREDENTIALS,
      limit: 1,
      fetch: mockFetch,
    });

    expect(result.volumes[0]).toBeInstanceOf(Volume);
    expect(result.volumes[0].name).toBe("workspace");
    await expect(result.toArray()).resolves.toEqual([
      expect.objectContaining({ name: "workspace" }),
      expect.objectContaining({ name: "cache" }),
    ]);
  });

  it("deletes a volume", async () => {
    const mockFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        volume: { ...volumePayload, currentSessionId: undefined },
      }),
    );
    const volume = await Volume.getOrCreate({
      ...CREDENTIALS,
      name: "workspace",
      fetch: mockFetch,
    });

    await volume.delete();

    const [url, init] = mockFetch.mock.calls[1];
    expect(String(url)).toContain("/v2/sandboxes/volumes/workspace");
    expect(String(url)).toContain("projectId=proj_123");
    expect(init?.method).toBe("DELETE");
  });
});
