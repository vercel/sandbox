import { describe, expect, test, vi } from "vitest";
import { readVercelGithubLink } from "../../src/util/managed-credentials-vercel";
import { inferActor } from "../../src/util/managed-credentials-actor";
const eligible = {
  provider: "github",
  type: "login",
  host: "github.com",
  oauthApp: "default",
  login: "ada",
  userId: "42",
  name: "Ada",
};
const lookup = (connections: unknown[]) =>
  readVercelGithubLink({
    token: "vercel-token",
    fetch: vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ connections }))),
  });
describe("Vercel account connections", () => {
  test("reads the real connections response and copies metadata only", async () => {
    expect(await lookup([{ ...eligible, accessToken: "never-copy" }])).toEqual({
      login: "ada",
      id: "42",
      name: "Ada",
    });
  });
  test.each([
    { host: "enterprise.example" },
    { type: "link" },
    { oauthApp: "limited" },
    { provider: "gitlab" },
    { login: null },
  ])("ignores ineligible %j", async (overrides) => {
    expect(await lookup([{ ...eligible, ...overrides }])).toBeUndefined();
  });
  test("rejects ambiguity", async () => {
    expect(
      await lookup([eligible, { ...eligible, login: "other" }]),
    ).toBeUndefined();
  });
  test("surfaces HTTP and transport errors", async () => {
    for (const fetch of [
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response("denied", { status: 403 })),
      vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline")),
    ]) {
      await expect(
        readVercelGithubLink({ token: "t", fetch }),
      ).rejects.toThrow();
    }
  });
});
describe("actor precedence", () => {
  test("explicit identity bypasses all inference", async () => {
    const readGh = vi.fn();
    const readVercel = vi.fn();
    expect(
      await inferActor({ explicit: "ada", token: "t", readGh, readVercel }),
    ).toMatchObject({ actAs: "@ada", source: "explicit" });
    expect(readGh).not.toHaveBeenCalled();
    expect(readVercel).not.toHaveBeenCalled();
  });
  test("gh wins even if Vercel could return a different account", async () => {
    const readVercel = vi.fn();
    expect(
      await inferActor({
        token: "t",
        readGh: vi.fn().mockResolvedValue({ login: "ada", id: 42 }),
        readVercel,
      }),
    ).toMatchObject({ actAs: "42", source: "gh" });
    expect(readVercel).not.toHaveBeenCalled();
  });
  test("falls back only when gh has no account", async () => {
    expect(
      await inferActor({
        token: "t",
        readGh: vi.fn().mockResolvedValue(undefined),
        readVercel: vi.fn().mockResolvedValue({ login: "ada", id: "42" }),
      }),
    ).toMatchObject({ actAs: "42", source: "vercel-account-link" });
    const readVercel = vi.fn();
    await expect(
      inferActor({
        token: "t",
        readGh: vi.fn().mockRejectedValue(new Error("offline")),
        readVercel,
      }),
    ).rejects.toThrow("offline");
    expect(readVercel).not.toHaveBeenCalled();
  });
});
