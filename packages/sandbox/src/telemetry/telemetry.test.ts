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
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

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
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://telemetry.vercel.com/api/sandbox-cli/v1/events");
    const headers = new Headers(init.headers);
    expect(headers.get("client-id")).toBe("sandbox-cli");
    expect(headers.get("x-sandbox-cli-topic-id")).toBe("generic");
    expect(headers.get("x-sandbox-cli-session-id")).toBeTruthy();

    const events = JSON.parse(String(init.body));
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
      argv: ["--token", "create"],
    });
    await telemetry.flush();

    const events = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const keys = events.map((event: { key: string }) => event.key);
    expect(keys).toContain("subcommand");
    expect(keys).toContain("version");
    expect(keys).toContain("platform");
    expect(keys).toContain("arch");
    expect(keys).not.toContain("embedded");
  });

  it("marks embedded invocations", async () => {
    const telemetry = new Telemetry();
    await telemetry.trackInvocation({
      appName: "vercel sandbox",
      argv: ["ls"],
    });
    await telemetry.flush();

    const events = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(events).toContainEqual(
      expect.objectContaining({ key: "embedded", value: "vercel sandbox" }),
    );
  });
});
