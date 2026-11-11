import {
  Drive as StandaloneDrive,
  APIError as DrivesAPIError,
} from "@vercel/drives";
import { describe, expect, it, vi } from "vitest";
import { Drive } from "./drive.js";
import { APIError } from "./api-client/api-error.js";

describe("Drive compatibility", () => {
  it("re-exports the standalone Drive class", () => {
    expect(Drive).toBe(StandaloneDrive);
  });

  it("keeps APIError checks compatible across both packages", async () => {
    expect(APIError).toBe(DrivesAPIError);
    const mockFetch = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { code: "not_found", message: "Drive not found." } },
        { status: 404 },
      ),
    );

    await expect(
      StandaloneDrive.get({
        name: "workspace",
        token: "test-token",
        teamId: "team_123",
        projectId: "proj_123",
        fetch: mockFetch,
      }),
    ).rejects.toBeInstanceOf(APIError);
  });
});
