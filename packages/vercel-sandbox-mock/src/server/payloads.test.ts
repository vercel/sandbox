import { describe, expect, test } from "vitest";
import {
  commandPayload,
  routePayload,
  routesPayload,
  sandboxPayload,
  sessionPayload,
  snapshotPayload,
} from "./payloads";
import type {
  CommandRecord,
  SandboxRecord,
  SessionRecord,
  SnapshotRecord,
} from "./registry";

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord =>
  ({
    id: "sess_1",
    sandboxName: "my-box",
    status: "running",
    timeout: 300_000,
    memory: 2048,
    vcpus: 2,
    region: "iad1",
    runtime: "node22",
    cwd: "/vercel/sandbox",
    createdAt: 1,
    requestedAt: 1,
    updatedAt: 2,
    ...overrides,
  }) as SessionRecord;

const sandbox = (overrides: Partial<SandboxRecord> = {}): SandboxRecord =>
  ({
    name: "my-box",
    persistent: false,
    region: "iad1",
    vcpus: 2,
    memory: 2048,
    runtime: "node22",
    timeout: 300_000,
    cwd: "/vercel/sandbox",
    ports: [],
    createdAt: 1,
    updatedAt: 2,
    sessionId: "sess_1",
    ...overrides,
  }) as SandboxRecord;

describe("routePayload / routesPayload", () => {
  test("builds a vercel.run URL from a sanitized subdomain", () => {
    expect(routePayload("My App_v2", 3000)).toEqual({
      url: "https://my-app-v2-3000.vercel.run",
      subdomain: "my-app-v2-3000",
      port: 3000,
    });
  });

  test("routesPayload maps every port", () => {
    expect(routesPayload("box", [3000, 8080]).map((r) => r.port)).toEqual([3000, 8080]);
  });
});

describe("network policy coercion", () => {
  test("mode-based policies pass through unchanged", () => {
    const payload = sessionPayload(session({ networkPolicy: { mode: "all" } }));
    expect(payload.networkPolicy).toEqual({ mode: "all" });
  });

  test("V2 `{ allow }` policies are reported as custom", () => {
    const payload = sandboxPayload(sandbox({ networkPolicy: { allow: [] } }), session());
    expect(payload.networkPolicy).toEqual({ mode: "custom" });
  });

  test("absent policies stay undefined", () => {
    expect(sessionPayload(session()).networkPolicy).toBeUndefined();
    expect(sandboxPayload(sandbox(), session()).networkPolicy).toBeUndefined();
  });
});

describe("sandboxPayload", () => {
  test("reports the current session's status and id", () => {
    const payload = sandboxPayload(sandbox(), session({ status: "stopped" }));
    expect(payload.status).toBe("stopped");
    expect(payload.currentSessionId).toBe("sess_1");
  });
});

describe("snapshotPayload", () => {
  test("exposes the snapshot fields the SDK validates", () => {
    const record: SnapshotRecord = {
      id: "snap_1",
      sandboxName: "my-box",
      sourceSessionId: "sess_1",
      region: "iad1",
      status: "created",
      sizeBytes: 42,
      createdAt: 1,
      updatedAt: 2,
      files: [],
    };
    expect(snapshotPayload(record)).toEqual({
      id: "snap_1",
      sourceSessionId: "sess_1",
      region: "iad1",
      status: "created",
      sizeBytes: 42,
      expiresAt: undefined,
      createdAt: 1,
      updatedAt: 2,
      parentId: undefined,
    });
  });
});

describe("commandPayload", () => {
  const record: CommandRecord = {
    id: "cmd_1",
    sessionId: "sess_1",
    name: "echo",
    args: ["hi"],
    cwd: "/vercel/sandbox",
    startedAt: 1,
    exitCode: null,
    stdout: "",
    stderr: "",
  };

  test("a running command reports a null exitCode", () => {
    expect(commandPayload(record).exitCode).toBeNull();
  });

  test("finished coerces a missing exitCode to 0", () => {
    expect(commandPayload(record, { finished: true }).exitCode).toBe(0);
  });

  test("finished preserves a real exitCode", () => {
    expect(commandPayload({ ...record, exitCode: 3 }, { finished: true }).exitCode).toBe(3);
  });
});
