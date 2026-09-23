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
    const init = fetchMock.mock.calls[0]?.[1];
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
});
