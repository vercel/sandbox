import { describe, expect, test, vi } from "vitest";
import { stripVTControlCharacters } from "node:util";
import { hasProjectBounds } from "../../src/util/project-bounds.ts";

const scope = { token: "tok_secret", team: "acme", project: "web app" };

function respond(status: number, body: unknown) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

async function failure(fetch: typeof globalThis.fetch): Promise<string> {
  try {
    await hasProjectBounds({ ...scope, fetch });
  } catch (error) {
    return stripVTControlCharacters((error as Error).message);
  }
  throw new Error("expected hasProjectBounds to reject");
}

const UNREADABLE = [
  "Cannot read the Bounds of project web app in team acme.",
  "hint: Check that your login or token can read that project. A project whose Bounds cannot be read is not treated as having none.",
].join("\n");

describe("hasProjectBounds", () => {
  test("reads the project's Bounds with the caller's token", async () => {
    const fetch = respond(200, {
      teamId: "team_123",
      projectId: "prj_123",
      bounds: [{ id: "bnd_1" }],
    });

    await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.vercel.com/v1/git-credential-broker/projects/web%20app/bounds?team=acme",
    );
    expect(init?.method ?? "GET").toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer tok_secret",
    );
  });

  test("reports a project without Bounds", async () => {
    const fetch = respond(200, {
      teamId: "team_123",
      projectId: "prj_123",
      bounds: [],
    });
    await expect(hasProjectBounds({ ...scope, fetch })).resolves.toBe(false);
  });

  test.each([401, 403, 404, 500])(
    "does not treat a %i response as having no Bounds",
    async (status) => {
      const message = await failure(
        respond(status, { error: { message: "leaked detail" } }),
      );
      expect(message).toBe(UNREADABLE);
    },
  );

  test.each([[{}], [{ bounds: "none" }], [null]])(
    "does not treat the unexpected body %j as having no Bounds",
    async (body) => {
      expect(await failure(respond(200, body))).toBe(UNREADABLE);
    },
  );

  test("strips control characters from the team and project it names", async () => {
    let message = "";
    try {
      await hasProjectBounds({
        token: "tok",
        team: "ac\u001b[2Jme",
        project: "we\nb",
        fetch: respond(500, {}),
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(
      "Cannot read the Bounds of project web in team ac[2Jme.",
    );
    expect(message).not.toMatch(/[\u0000-\u0009\u000b-\u001a\u001c-\u001f]/);
  });

  test("does not treat a network failure as having no Bounds", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError("fetch failed: tok_secret");
    });
    const message = await failure(fetch);
    expect(message).toBe(UNREADABLE);
    expect(message).not.toContain("tok_secret");
  });
});
