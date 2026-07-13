import { describe, expect, test } from "vitest";
import { MockServer } from "./mock-server";

const BASE = "https://vercel.com/api";

// The Node `Response.json()` type is `unknown`; these are internal wire bodies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (res: Response): Promise<any> => res.json();

function makeServer() {
  const server = new MockServer();
  const call = (
    method: string,
    path: string,
    opts?: { body?: unknown; headers?: Record<string, string> },
  ) =>
    server.fetch(`${BASE}${path}`, {
      method,
      headers: opts?.headers,
      body: opts?.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  return { server, call };
}

async function createSandbox(call: ReturnType<typeof makeServer>["call"], body: object = {}) {
  return j(await call("POST", "/v2/sandboxes", { body }));
}

describe("MockServer routing", () => {
  test("POST /v2/sandboxes creates a sandbox with a running session and routes", async () => {
    const { call } = makeServer();
    const res = await call("POST", "/v2/sandboxes", { body: { name: "sb", ports: [3000] } });
    expect(res.status).toBe(200);
    const data = await j(res);
    expect(data.sandbox.name).toBe("sb");
    expect(data.session.status).toBe("running");
    expect(data.routes).toEqual([
      expect.objectContaining({ port: 3000, subdomain: expect.stringContaining("sb") }),
    ]);
    expect(data.resumed).toBe(false);
  });

  test("GET unknown sandbox → 404 with not_found code", async () => {
    const { call } = makeServer();
    const res = await call("GET", "/v2/sandboxes/ghost");
    expect(res.status).toBe(404);
    expect((await j(res)).error.code).toBe("not_found");
  });

  test("unknown route → 404", async () => {
    const { call } = makeServer();
    expect((await call("GET", "/v2/sandboxes/sessions/x/bogus")).status).toBe(404);
  });

  test("list filters by namePrefix and tags", async () => {
    const { call } = makeServer();
    await createSandbox(call, { name: "ci-a", tags: { team: "x" } });
    await createSandbox(call, { name: "ci-b", tags: { team: "y" } });
    await createSandbox(call, { name: "dev-c" });

    const prefixed = await j(await call("GET", "/v2/sandboxes?namePrefix=ci-"));
    expect(prefixed.sandboxes.map((s: { name: string }) => s.name).sort()).toEqual(["ci-a", "ci-b"]);

    const tagged = await j(await call("GET", "/v2/sandboxes?tags=team:x"));
    expect(tagged.sandboxes.map((s: { name: string }) => s.name)).toEqual(["ci-a"]);
  });

  describe("commands", () => {
    test("runCommand wait:true streams command → finished chunks as NDJSON", async () => {
      const { call } = makeServer();
      const { session } = await createSandbox(call);
      const res = await call("POST", `/v2/sandboxes/sessions/${session.id}/cmd`, {
        body: { command: "echo", args: ["hi"], env: {}, sudo: false, wait: true, logs: true },
      });
      expect(res.headers.get("content-type")).toBe("application/x-ndjson");
      const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));

      expect(lines[0].command.exitCode).toBeNull(); // running chunk
      expect(lines).toContainEqual({ stream: "stdout", data: "hi\n" });
      expect(lines.at(-1).command.exitCode).toBe(0); // finished chunk
    });

    test("detached runCommand returns JSON; getCommand(wait) and logs work", async () => {
      const { call } = makeServer();
      const { session } = await createSandbox(call);
      const run = await call("POST", `/v2/sandboxes/sessions/${session.id}/cmd`, {
        body: { command: "echo", args: ["yo"], env: {}, sudo: false },
      });
      expect(run.headers.get("content-type")).toContain("application/json");
      const { command } = await j(run);

      const finished = await j(
        await call("GET", `/v2/sandboxes/sessions/${session.id}/cmd/${command.id}?wait=true`),
      );
      expect(finished.command.exitCode).toBe(0);

      const logs = await (
        await call("GET", `/v2/sandboxes/sessions/${session.id}/cmd/${command.id}/logs`)
      ).text();
      expect(logs).toContain('"data":"yo\\n"');
    });
  });

  describe("filesystem", () => {
    test("mkdir + read missing → 404, read present → octet-stream", async () => {
      const { server, call } = makeServer();
      const { session } = await createSandbox(call);
      await call("POST", `/v2/sandboxes/sessions/${session.id}/fs/mkdir`, { body: { path: "/data" } });

      const missing = await call("POST", `/v2/sandboxes/sessions/${session.id}/fs/read`, {
        body: { path: "/data/none" },
      });
      expect(missing.status).toBe(404);

      // Seed a file through the command executor, then read it back.
      await server.fetch(`${BASE}/v2/sandboxes/sessions/${session.id}/cmd`, {
        method: "POST",
        body: JSON.stringify({
          command: "sh",
          args: ["-c", "printf data > /data/f"],
          env: {},
          sudo: false,
          wait: true,
        }),
      });
      const read = await call("POST", `/v2/sandboxes/sessions/${session.id}/fs/read`, {
        body: { path: "/data/f" },
      });
      expect(read.status).toBe(200);
      expect(read.headers.get("content-type")).toContain("application/octet-stream");
      expect(await read.text()).toBe("data");
    });
  });

  describe("lifecycle", () => {
    test("after stop, command endpoints 410 to trigger resume", async () => {
      const { call } = makeServer();
      const { session } = await createSandbox(call);
      await call("POST", `/v2/sandboxes/sessions/${session.id}/stop`);
      const res = await call("POST", `/v2/sandboxes/sessions/${session.id}/cmd`, {
        body: { command: "echo", args: [], env: {}, sudo: false, wait: true },
      });
      expect(res.status).toBe(410);
      expect((await j(res)).error.code).toBe("sandbox_stopped");
    });

    test("getSandbox?resume=true starts a fresh running session", async () => {
      const { call } = makeServer();
      const { sandbox, session } = await createSandbox(call, { name: "res" });
      await call("POST", `/v2/sandboxes/sessions/${session.id}/stop`);
      const resumed = await j(await call("GET", "/v2/sandboxes/res?resume=true"));
      expect(resumed.resumed).toBe(true);
      expect(resumed.session.status).toBe("running");
      expect(resumed.session.id).not.toBe(session.id);
      expect(resumed.sandbox.name).toBe(sandbox.name);
    });
  });

  describe("snapshots", () => {
    test("create → list (by name) → get → delete, with snapshot_not_found on stale restore", async () => {
      const { call } = makeServer();
      const { session } = await createSandbox(call, { name: "snap-sb" });
      const created = await j(
        await call("POST", `/v2/sandboxes/sessions/${session.id}/snapshot`, { body: {} }),
      );
      const snapshotId = created.snapshot.id;

      const listed = await j(await call("GET", "/v2/sandboxes/snapshots?name=snap-sb"));
      expect(listed.snapshots.map((s: { id: string }) => s.id)).toContain(snapshotId);

      const got = await j(await call("GET", `/v2/sandboxes/snapshots/${snapshotId}`));
      expect(got.snapshot.status).toBe("created");

      const deleted = await j(await call("DELETE", `/v2/sandboxes/snapshots/${snapshotId}`));
      expect(deleted.snapshot.status).toBe("deleted");

      const recreate = await call("POST", "/v2/sandboxes", {
        body: { name: "child", source: { type: "snapshot", snapshotId } },
      });
      expect(recreate.status).toBe(410);
      expect((await j(recreate)).error.code).toBe("snapshot_not_found");
    });
  });
});
