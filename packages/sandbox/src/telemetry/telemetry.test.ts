import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configRoot = mkdtempSync(join(tmpdir(), "sandbox-telemetry-test-"));

vi.mock("xdg-app-paths", () => ({
  default: (name: string) => ({
    config: () => join(configRoot, name),
    cache: () => join(configRoot, name, "cache"),
  }),
}));

import { Telemetry, writeTelemetryConfig } from "./index";

describe("telemetry", () => {
  const fetchMock = vi.fn(
    async (..._args: Parameters<typeof globalThis.fetch>) =>
      new Response(null, { status: 204 }),
  );

  function sentEvents(): Array<Record<string, string>> {
    const init = fetchMock.mock.calls.at(-1)?.[1];
    return JSON.parse(String(init?.body));
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VERCEL_TELEMETRY_DEBUG", "");
    vi.stubEnv("VERCEL_TELEMETRY_DISABLED", "");
    vi.stubEnv("VERCEL_SANDBOX_TELEMETRY_DISABLED", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockClear();
    rmSync(configRoot, { recursive: true, force: true });
  });

  it("sends buffered events with session and team metadata", async () => {
    const telemetry = new Telemetry();
    telemetry.track("subcommand", "create");
    telemetry.updateTeamId("team_123");
    await telemetry.flush();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://telemetry.vercel.com/api/sandbox-cli/v1/events");
    const headers = new Headers(init?.headers);
    expect(headers.get("client-id")).toBe("sandbox-cli");
    expect(headers.get("x-sandbox-cli-topic-id")).toBe("generic");
    expect(headers.get("x-sandbox-cli-session-id")).toBeTruthy();

    const events = sentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      key: "subcommand",
      value: "create",
      team_id: "team_123",
    });
    expect(events[0].id).toBeTruthy();
    expect(events[0].session_id).toBeTruthy();
  });

  it("does not send anything when disabled via environment", async () => {
    vi.stubEnv("VERCEL_SANDBOX_TELEMETRY_DISABLED", "1");
    const telemetry = new Telemetry();
    telemetry.track("subcommand", "create");
    await telemetry.flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send anything when disabled via config file", async () => {
    writeTelemetryConfig(false);
    const telemetry = new Telemetry();
    telemetry.track("subcommand", "create");
    await telemetry.flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prints events to stderr instead of sending in debug mode", async () => {
    vi.stubEnv("VERCEL_TELEMETRY_DEBUG", "1");
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const telemetry = new Telemetry();
    telemetry.track("subcommand", "create");
    await telemetry.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("[telemetry]"),
    );
    stderr.mockRestore();
  });

  it("swallows network errors from the bridge", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const telemetry = new Telemetry();
    telemetry.track("subcommand", "create");
    await expect(telemetry.flush()).resolves.toBeUndefined();
  });

  it("tracks the invocation subcommand and environment facts", async () => {
    const telemetry = new Telemetry();
    await telemetry.trackInvocation({
      appName: "sandbox",
      argv: ["create", "--token", "secret"],
    });
    await telemetry.flush();

    const events = sentEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ key: "subcommand", value: "create" }),
    );
    const keys = events.map((event) => event.key);
    expect(keys).toContain("version");
    expect(keys).toContain("platform");
    expect(keys).toContain("arch");
    expect(keys).not.toContain("embedded");
  });

  it("records no subcommand when argv does not start with a known command", async () => {
    const telemetry = new Telemetry();
    // A registered command name appearing as an option value must not win:
    // cmd-ts only dispatches on argv[0].
    await telemetry.trackInvocation({
      appName: "sandbox",
      argv: ["--scope", "create", "exec", "my-box"],
    });
    await telemetry.flush();

    const keys = sentEvents().map((event) => event.key);
    expect(keys).not.toContain("subcommand");
  });

  it("carries project id and the Vercel CLI invocation id on every event", async () => {
    vi.stubEnv("VERCEL_CLI_INVOCATION_ID", "inv_123");
    const telemetry = new Telemetry();
    telemetry.updateProjectId("prj_123");
    telemetry.track("subcommand", "create");
    await telemetry.flush();

    expect(sentEvents()[0]).toMatchObject({
      project_id: "prj_123",
      vercel_cli_invocation_id: "inv_123",
    });
  });

  it("records sandbox session ids with their origin", async () => {
    const telemetry = new Telemetry();
    telemetry.trackSandboxSession("sbx_abc", "created");
    await telemetry.flush();

    const events = sentEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ key: "sandbox_session_id", value: "sbx_abc" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ key: "sandbox_session_origin", value: "created" }),
    );
  });

  it("marks embedded invocations", async () => {
    const telemetry = new Telemetry();
    await telemetry.trackInvocation({
      appName: "vercel sandbox",
      argv: ["ls"],
    });
    await telemetry.flush();

    expect(sentEvents()).toContainEqual(
      expect.objectContaining({ key: "embedded", value: "vercel sandbox" }),
    );
  });

  describe("scope slugs", () => {
    function lookupResponse(body: unknown, status = 200) {
      fetchMock.mockImplementationOnce(
        async () => new Response(JSON.stringify(body), { status }),
      );
    }

    it("keeps slugs out of the id fields", async () => {
      const telemetry = new Telemetry();
      telemetry.updateTeamId("my-team");
      telemetry.updateProjectId("my-app");
      telemetry.track("subcommand", "list");
      await telemetry.flush();

      const events = sentEvents();
      expect(fetchMock).toHaveBeenCalledOnce();
      for (const event of events) {
        expect(event.team_id).toBe("NO_TEAM_ID");
        expect(event.project_id).toBeNull();
      }
      expect(events).toContainEqual(
        expect.objectContaining({ key: "team_slug", value: "my-team" }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({ key: "project_slug", value: "my-app" }),
      );
    });

    it("records each slug once across repeated scope updates", async () => {
      const telemetry = new Telemetry();
      telemetry.updateTeamId("my-team");
      telemetry.updateTeamId("my-team");
      await telemetry.flush();

      const slugs = sentEvents().filter((event) => event.key === "team_slug");
      expect(slugs).toHaveLength(1);
    });

    it("resolves slugs to ids before sending", async () => {
      lookupResponse({ id: "prj_abc", accountId: "team_abc" });
      const telemetry = new Telemetry();
      telemetry.updateTeamId("my-team");
      telemetry.updateProjectId("my-app");
      telemetry.resolveScopeIds("token");
      telemetry.track("subcommand", "list");
      await telemetry.flush();

      const [lookupUrl, lookupInit] = fetchMock.mock.calls[0]!;
      expect(lookupUrl).toBe(
        "https://vercel.com/api/v9/projects/my-app?slug=my-team",
      );
      expect(new Headers(lookupInit?.headers).get("authorization")).toBe(
        "Bearer token",
      );
      for (const event of sentEvents()) {
        expect(event.team_id).toBe("team_abc");
        expect(event.project_id).toBe("prj_abc");
      }
    });

    it("looks up a project slug under a team id", async () => {
      lookupResponse({ id: "prj_abc", accountId: "team_123" });
      const telemetry = new Telemetry();
      telemetry.updateTeamId("team_123");
      telemetry.updateProjectId("my-app");
      telemetry.resolveScopeIds("token");
      await telemetry.flush();

      expect(fetchMock.mock.calls[0]![0]).toBe(
        "https://vercel.com/api/v9/projects/my-app?teamId=team_123",
      );
      expect(sentEvents()[0]).toMatchObject({ project_id: "prj_abc" });
    });

    it("leaves ids unset when the lookup fails", async () => {
      lookupResponse({ error: { code: "not_found" } }, 404);
      const telemetry = new Telemetry();
      telemetry.updateTeamId("my-team");
      telemetry.updateProjectId("my-app");
      telemetry.resolveScopeIds("token");
      await telemetry.flush();

      expect(sentEvents()[0]).toMatchObject({
        team_id: "NO_TEAM_ID",
        project_id: null,
      });
    });

    it("ignores a personal account id from the lookup", async () => {
      lookupResponse({ id: "prj_abc", accountId: "user_abc" });
      const telemetry = new Telemetry();
      telemetry.updateTeamId("my-name");
      telemetry.updateProjectId("my-app");
      telemetry.resolveScopeIds("token");
      await telemetry.flush();

      expect(sentEvents()[0]).toMatchObject({
        team_id: "NO_TEAM_ID",
        project_id: "prj_abc",
      });
    });

    it("skips the lookup when the scope is already ids", async () => {
      const telemetry = new Telemetry();
      telemetry.updateTeamId("team_123");
      telemetry.updateProjectId("prj_123");
      telemetry.resolveScopeIds("token");
      telemetry.track("subcommand", "list");
      await telemetry.flush();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(sentEvents().map((event) => event.key)).not.toContain(
        "team_slug",
      );
    });

    it("skips the lookup when telemetry is disabled", async () => {
      vi.stubEnv("VERCEL_SANDBOX_TELEMETRY_DISABLED", "1");
      const telemetry = new Telemetry();
      telemetry.updateTeamId("my-team");
      telemetry.updateProjectId("my-app");
      telemetry.resolveScopeIds("token");
      await telemetry.flush();

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("user id", () => {
    it("sends the caller's user id on every event", async () => {
      fetchMock.mockImplementationOnce(
        async () => new Response(JSON.stringify({ user: { id: "user_abc" } })),
      );
      const telemetry = new Telemetry();
      telemetry.resolveUserId("token");
      telemetry.resolveUserId("token");
      telemetry.track("subcommand", "list");
      telemetry.track("exit_code", "0");
      await telemetry.flush();

      const [lookupUrl, lookupInit] = fetchMock.mock.calls[0]!;
      expect(lookupUrl).toBe("https://vercel.com/api/v2/user");
      expect(new Headers(lookupInit?.headers).get("authorization")).toBe(
        "Bearer token",
      );
      // One lookup, then the bridge.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const event of sentEvents()) {
        expect(event.user_id).toBe("user_abc");
      }
    });

    it("sends a null user id when the lookup fails", async () => {
      fetchMock.mockImplementationOnce(
        async () => new Response(null, { status: 403 }),
      );
      const telemetry = new Telemetry();
      telemetry.resolveUserId("token");
      telemetry.track("subcommand", "list");
      await telemetry.flush();

      expect(sentEvents()[0]).toMatchObject({ user_id: null });
    });

    it("skips the lookup without a token", async () => {
      const telemetry = new Telemetry();
      telemetry.resolveUserId(undefined);
      telemetry.track("subcommand", "list");
      await telemetry.flush();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(sentEvents()[0]).toMatchObject({ user_id: null });
    });
  });
});
