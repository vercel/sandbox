import { describe, it, expect, beforeEach } from "vitest";
import {
  setSandboxCredentials,
  getSandboxCredentials,
} from "./sandbox-credentials";

describe("sandbox-credentials", () => {
  // Reset module state between tests by overwriting with a known value then
  // clearing. We import from the same module instance so this is stateful.
  beforeEach(async () => {
    // Re-import to get a fresh module with cleared state
    const mod = await import("./sandbox-credentials");
    // Set then clear to ensure clean state
    try {
      mod.getSandboxCredentials();
      // If it didn't throw, overwrite
    } catch {
      // Expected — not set
    }
  });

  it("getSandboxCredentials throws with a helpful message when unset", async () => {
    // Use dynamic import with resetModules to get clean state
    const { vi } = await import("vitest");
    vi.resetModules();
    const { getSandboxCredentials: freshGet } = await import(
      "./sandbox-credentials"
    );

    expect(() => freshGet()).toThrowError(
      /Global credentials have not been set/,
    );
    expect(() => freshGet()).toThrowError(/setSandboxCredentials/);
  });

  it("setSandboxCredentials followed by getSandboxCredentials returns credentials", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const { setSandboxCredentials: freshSet, getSandboxCredentials: freshGet } =
      await import("./sandbox-credentials");

    freshSet({ token: "tok_123", teamId: "team_abc" });

    const creds = freshGet();
    expect(creds.token).toBe("tok_123");
    expect(creds.teamId).toBe("team_abc");
  });

  it("calling setSandboxCredentials a second time overwrites", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const { setSandboxCredentials: freshSet, getSandboxCredentials: freshGet } =
      await import("./sandbox-credentials");

    freshSet({ token: "tok_first", teamId: "team_first" });
    freshSet({ token: "tok_second", teamId: "team_second" });

    const creds = freshGet();
    expect(creds.token).toBe("tok_second");
    expect(creds.teamId).toBe("team_second");
  });

  it("accepts credentials without projectId", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const { setSandboxCredentials: freshSet, getSandboxCredentials: freshGet } =
      await import("./sandbox-credentials");

    freshSet({ token: "tok_123", teamId: "team_abc" });

    const creds = freshGet();
    expect(creds.projectId).toBeUndefined();
  });

  it("accepts credentials with optional projectId", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    const { setSandboxCredentials: freshSet, getSandboxCredentials: freshGet } =
      await import("./sandbox-credentials");

    freshSet({
      token: "tok_123",
      teamId: "team_abc",
      projectId: "prj_xyz",
    });

    const creds = freshGet();
    expect(creds.projectId).toBe("prj_xyz");
  });
});
