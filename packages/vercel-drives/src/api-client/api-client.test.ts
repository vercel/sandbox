import { describe, it, expect, vi } from "vitest";
import { APIClient } from "./api-client.js";

describe("APIClient", () => {
  describe("listDrives", () => {
    it("passes the supported query parameters", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            drives: [],
            pagination: { count: 0, next: null },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
      const client = new APIClient({
        teamId: "team_123",
        token: "1234",
        fetch: mockFetch,
      });

      await client.listDrives({
        projectId: "proj_123",
        limit: 5,
        cursor: "opaque-cursor",
        sortBy: "name",
        sortOrder: "asc",
        namePrefix: "test-",
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("projectId=proj_123");
      expect(url).toContain("limit=5");
      expect(url).toContain("cursor=opaque-cursor");
      expect(url).toContain("sortBy=name");
      expect(url).toContain("sortOrder=asc");
      expect(url).toContain("namePrefix=test-");
    });
  });
});
