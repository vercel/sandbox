import { describe, expect, test } from "vitest";
import { command as handler } from "../handlers";
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

async function createSandbox(
  call: ReturnType<typeof makeServer>["call"],
  body: object = {},
) {
  return j(await call("POST", "/v3/sandboxes", { body }));
}

describe("MockServer routing", () => {
  test("POST /v3/sandboxes creates a sandbox with a running session and routes", async () => {
    const { call } = makeServer();
    const res = await call("POST", "/v3/sandboxes", {
      body: { name: "sb", ports: [3000] },
    });
    expect(res.status).toBe(200);
    const data = await j(res);
    expect(data.sandbox.name).toBe("sb");
    expect(data.session.status).toBe("running");
    expect(data.routes).toEqual([
      expect.objectContaining({
        port: 3000,
        subdomain: expect.stringContaining("sb"),
      }),
    ]);
    expect(data.resumed).toBe(false);
  });

  test("an image override clears a copied legacy runtime when forking", async () => {
    const { call } = makeServer();
    await j(
      await call("POST", "/v2/sandboxes", {
        body: { name: "legacy", runtime: "node24" },
      }),
    );

    const fork = await j(
      await call("POST", "/v2/sandboxes/legacy/fork", {
        body: { name: "image-fork", image: "test-image" },
      }),
    );

    expect(fork.sandbox.runtime).toBeUndefined();
    expect(fork.session.runtime).toBeUndefined();
  });

  test("GET unknown sandbox → 404 with not_found code", async () => {
    const { call } = makeServer();
    const res = await call("GET", "/v2/sandboxes/ghost");
    expect(res.status).toBe(404);
    expect((await j(res)).error.code).toBe("not_found");
  });

  test("unknown route → 404", async () => {
    const { call } = makeServer();
    expect((await call("GET", "/v2/sandboxes/sessions/x/bogus")).status).toBe(
      404,
    );
  });

  test("list filters by namePrefix and tags", async () => {
    const { call } = makeServer();
    await createSandbox(call, { name: "ci-a", tags: { team: "x" } });
    await createSandbox(call, { name: "ci-b", tags: { team: "y" } });
    await createSandbox(call, { name: "dev-c" });

    const prefixed = await j(await call("GET", "/v2/sandboxes?namePrefix=ci-"));
    expect(
      prefixed.sandboxes.map((s: { name: string }) => s.name).sort(),
    ).toEqual(["ci-a", "ci-b"]);

    const tagged = await j(await call("GET", "/v2/sandboxes?tags=team:x"));
    expect(tagged.sandboxes.map((s: { name: string }) => s.name)).toEqual([
      "ci-a",
    ]);
  });

  describe("commands", () => {
    test("runCommand wait:true streams command → finished chunks as NDJSON", async () => {
      const { call } = makeServer();
      const { session } = await createSandbox(call);
      const res = await call(
        "POST",
        `/v2/sandboxes/sessions/${session.id}/cmd`,
        {
          body: {
            command: "echo",
            args: ["hi"],
            env: {},
            sudo: false,
            wait: true,
            logs: true,
          },
        },
      );
      expect(res.headers.get("content-type")).toBe("application/x-ndjson");
      const lines = (await res.text())
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      expect(lines[0].command.exitCode).toBeNull(); // running chunk
      expect(lines).toContainEqual({ stream: "stdout", data: "hi\n" });
      expect(lines.at(-1).command.exitCode).toBe(0); // finished chunk
    });

    test("detached runCommand returns JSON; getCommand(wait) and logs work", async () => {
      const { call } = makeServer();
      const { session } = await createSandbox(call);
      const run = await call(
        "POST",
        `/v2/sandboxes/sessions/${session.id}/cmd`,
        {
          body: { command: "echo", args: ["yo"], env: {}, sudo: false },
        },
      );
      expect(run.headers.get("content-type")).toContain("application/json");
      const { command } = await j(run);

      const finished = await j(
        await call(
          "GET",
          `/v2/sandboxes/sessions/${session.id}/cmd/${command.id}?wait=true`,
        ),
      );
      expect(finished.command.exitCode).toBe(0);

      const logs = await (
        await call(
          "GET",
          `/v2/sandboxes/sessions/${session.id}/cmd/${command.id}/logs`,
        )
      ).text();
      expect(logs).toContain('"data":"yo\\n"');
    });
  });

  describe("stdin", () => {
    const b64 = (text: string) => Buffer.from(text).toString("base64");

    async function startCat(
      call: ReturnType<typeof makeServer>["call"],
      name = "cat",
    ) {
      const { session } = await createSandbox(call);
      const { command } = await j(
        await call("POST", `/v2/sandboxes/sessions/${session.id}/cmd`, {
          body: { command: name, env: {}, sudo: false, attachStdin: true },
        }),
      );
      const base = `/v2/sandboxes/sessions/${session.id}/cmd/${command.id}`;
      const write = (body: object) => call("POST", `${base}/stdin`, { body });
      return { session, command, base, write, b64 };
    }

    test("buffers writes, skips resent bytes, and runs the command on close", async () => {
      const { call } = makeServer();
      const { command, base, write, b64 } = await startCat(call);
      expect(command.exitCode).toBeNull();

      expect(await j(await write({ data: b64("hello "), offset: 0 }))).toEqual(
        expect.objectContaining({ bytesWritten: 6 }),
      );
      const resent = await j(
        await write({ data: b64("hello world"), offset: 0 }),
      );
      expect(resent.bytesWritten).toBe(11);
      expect(
        (await j(await write({ close: true, offset: 11 }))).bytesWritten,
      ).toBe(11);
      expect((await write({ close: true, offset: 11 })).status).toBe(200);

      const finished = await j(await call("GET", `${base}?wait=true`));
      expect(finished.command.exitCode).toBe(0);
      expect(await (await call("GET", `${base}/logs`)).text()).toContain(
        '"data":"hello world"',
      );
      const exited = await write({ data: b64("late") });
      expect(exited.status).toBe(404);
      expect((await j(exited)).error.code).toBe("command_not_found_or_exited");
    });

    test("rejects offsets past the bytes written and bad input", async () => {
      const { call } = makeServer();
      const { write, b64 } = await startCat(call);
      await write({ data: b64("abc"), offset: 0 });

      const past = await write({ data: b64("d"), offset: 4 });
      expect(past.status).toBe(409);
      expect((await j(past)).error.code).toBe("command_stdin_offset_mismatch");
      expect((await write({ close: true, offset: 2 })).status).toBe(409);
      const invalid = await write({ data: "not base64!" });
      expect(invalid.status).toBe(400);
      expect((await j(invalid)).error.code).toBe("bad_request");
      expect((await write({ offset: -1 })).status).toBe(400);
    });

    test("after close, new bytes are rejected but resends still succeed", async () => {
      const { server, call } = makeServer();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      server.setDefaultHandlers([
        handler("slow", async () => {
          await gate;
          return {};
        }),
      ]);
      const { base, write } = await startCat(call, "slow");

      expect(
        (await write({ data: b64("ab"), offset: 0, close: true })).status,
      ).toBe(200);
      expect(
        (await write({ data: b64("ab"), offset: 0, close: true })).status,
      ).toBe(200);
      expect((await write({ data: b64("ab"), offset: 0 })).status).toBe(200);
      expect((await j(await write({}))).bytesWritten).toBe(2);
      const extra = await write({ data: b64("c"), offset: 2 });
      expect(extra.status).toBe(400);
      expect((await j(extra)).error.code).toBe("command_stdin_unavailable");
      expect((await write({ close: true })).status).toBe(400);

      release();
      const finished = await j(await call("GET", `${base}?wait=true`));
      expect(finished.command.exitCode).toBe(0);
    });

    test("a command that has exited rejects writes with 404", async () => {
      const { call } = makeServer();
      const { session } = await createSandbox(call);
      const { command } = await j(
        await call("POST", `/v2/sandboxes/sessions/${session.id}/cmd`, {
          body: { command: "echo", env: {}, sudo: false },
        }),
      );
      const res = await call(
        "POST",
        `/v2/sandboxes/sessions/${session.id}/cmd/${command.id}/stdin`,
        { body: { data: "aGk=" } },
      );
      expect(res.status).toBe(404);
      expect((await j(res)).error.code).toBe("command_not_found_or_exited");
    });

    test("wait:true streams the command chunk before stdin closes", async () => {
      const { call } = makeServer();
      const { session } = await createSandbox(call);
      const res = await call(
        "POST",
        `/v2/sandboxes/sessions/${session.id}/cmd`,
        {
          body: {
            command: "cat",
            env: {},
            sudo: false,
            wait: true,
            logs: true,
            attachStdin: true,
          },
        },
      );
      const reader = res.body!.getReader();
      const first = JSON.parse(
        new TextDecoder().decode((await reader.read()).value),
      );
      expect(first.command.exitCode).toBeNull();

      await call(
        "POST",
        `/v2/sandboxes/sessions/${session.id}/cmd/${first.command.id}/stdin`,
        { body: { data: b64("hi"), close: true } },
      );
      let rest = "";
      for (
        let chunk = await reader.read();
        !chunk.done;
        chunk = await reader.read()
      ) {
        rest += new TextDecoder().decode(chunk.value);
      }
      const lines = rest
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      expect(lines).toContainEqual({ stream: "stdout", data: "hi" });
      expect(lines.at(-1).command.exitCode).toBe(0);
    });

    test("killing a command waiting for stdin finishes it", async () => {
      const { call } = makeServer();
      const { base } = await startCat(call);
      await call("POST", `${base}/kill`, { body: { signal: 15 } });
      const finished = await j(await call("GET", `${base}?wait=true`));
      expect(finished.command.exitCode).toBe(143);
    });

    test("kill and session stop end a command running after close", async () => {
      const { server, call } = makeServer();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      server.setDefaultHandlers([
        handler("slow", async () => {
          await gate;
          return { stdout: "late" };
        }),
      ]);
      const killed = await startCat(call, "slow");
      await killed.write({ close: true });
      await call("POST", `${killed.base}/kill`, { body: { signal: 15 } });
      expect(
        (await j(await call("GET", `${killed.base}?wait=true`))).command
          .exitCode,
      ).toBe(143);

      const stopped = await startCat(call, "slow");
      await stopped.write({ close: true });
      await call("POST", `/v2/sandboxes/sessions/${stopped.session.id}/stop`);
      expect(
        (await j(await call("GET", `${stopped.base}?wait=true`))).command
          .exitCode,
      ).toBe(137);

      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await j(await call("GET", killed.base))).command.exitCode).toBe(
        143,
      );
      expect((await j(await call("GET", stopped.base))).command.exitCode).toBe(
        137,
      );
      expect(
        await (await call("GET", `${killed.base}/logs`)).text(),
      ).not.toContain("late");
    });

    test("stopping the session ends a command waiting for stdin", async () => {
      const { call } = makeServer();
      const { session, base } = await startCat(call);
      await call("POST", `/v2/sandboxes/sessions/${session.id}/stop`);
      const finished = await j(await call("GET", `${base}?wait=true`));
      expect(finished.command.exitCode).toBe(137);
    });

    test("an aborted wait rejects instead of waiting for stdin", async () => {
      const { server, call } = makeServer();
      const { base } = await startCat(call);
      await expect(
        server.fetch(`${BASE}${base}?wait=true`, {
          signal: AbortSignal.timeout(10),
        }),
      ).rejects.toThrow();
    });
  });

  describe("filesystem", () => {
    test("mkdir + read missing → 404, read present → octet-stream", async () => {
      const { server, call } = makeServer();
      const { session } = await createSandbox(call);
      await call("POST", `/v2/sandboxes/sessions/${session.id}/fs/mkdir`, {
        body: { path: "/data" },
      });

      const missing = await call(
        "POST",
        `/v2/sandboxes/sessions/${session.id}/fs/read`,
        {
          body: { path: "/data/none" },
        },
      );
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
      const read = await call(
        "POST",
        `/v2/sandboxes/sessions/${session.id}/fs/read`,
        {
          body: { path: "/data/f" },
        },
      );
      expect(read.status).toBe(200);
      expect(read.headers.get("content-type")).toContain(
        "application/octet-stream",
      );
      expect(await read.text()).toBe("data");
    });
  });

  describe("lifecycle", () => {
    test("after stop, command endpoints 410 to trigger resume", async () => {
      const { call } = makeServer();
      const { session } = await createSandbox(call);
      await call("POST", `/v2/sandboxes/sessions/${session.id}/stop`);
      const res = await call(
        "POST",
        `/v2/sandboxes/sessions/${session.id}/cmd`,
        {
          body: { command: "echo", args: [], env: {}, sudo: false, wait: true },
        },
      );
      expect(res.status).toBe(410);
      expect((await j(res)).error.code).toBe("sandbox_stopped");
    });

    test("getSandbox?resume=true starts a fresh running session", async () => {
      const { call } = makeServer();
      const { sandbox, session } = await createSandbox(call, { name: "res" });
      await call("POST", `/v2/sandboxes/sessions/${session.id}/stop`);
      const resumed = await j(
        await call("GET", "/v2/sandboxes/res?resume=true"),
      );
      expect(resumed.resumed).toBe(true);
      expect(resumed.session.status).toBe("running");
      expect(resumed.session.id).not.toBe(session.id);
      expect(resumed.sandbox.name).toBe(sandbox.name);
    });
  });

  describe("snapshots", () => {
    test("restoring a legacy snapshot preserves its runtime metadata", async () => {
      const { call } = makeServer();
      const { session } = await j(
        await call("POST", "/v2/sandboxes", {
          body: { name: "legacy-snapshot", runtime: "node24" },
        }),
      );
      const created = await j(
        await call("POST", `/v2/sandboxes/sessions/${session.id}/snapshot`, {
          body: {},
        }),
      );

      const restored = await j(
        await call("POST", "/v3/sandboxes", {
          body: {
            name: "restored-legacy",
            source: { type: "snapshot", snapshotId: created.snapshot.id },
          },
        }),
      );

      expect(restored.sandbox.runtime).toBe("node24");
      expect(restored.session.runtime).toBe("node24");
    });

    test("create → list (by name) → get → delete, with snapshot_not_found on stale restore", async () => {
      const { call } = makeServer();
      const { session } = await createSandbox(call, { name: "snap-sb" });
      const created = await j(
        await call("POST", `/v2/sandboxes/sessions/${session.id}/snapshot`, {
          body: {},
        }),
      );
      const snapshotId = created.snapshot.id;

      const listed = await j(
        await call("GET", "/v2/sandboxes/snapshots?name=snap-sb"),
      );
      expect(listed.snapshots.map((s: { id: string }) => s.id)).toContain(
        snapshotId,
      );

      const got = await j(
        await call("GET", `/v2/sandboxes/snapshots/${snapshotId}`),
      );
      expect(got.snapshot.status).toBe("created");

      const deleted = await j(
        await call("DELETE", `/v2/sandboxes/snapshots/${snapshotId}`),
      );
      expect(deleted.snapshot.status).toBe("deleted");

      const recreate = await call("POST", "/v3/sandboxes", {
        body: { name: "child", source: { type: "snapshot", snapshotId } },
      });
      expect(recreate.status).toBe(410);
      expect((await j(recreate)).error.code).toBe("snapshot_not_found");
    });

    test("deleting a sandbox keeps its snapshots unless asked to delete them", async () => {
      const { call } = makeServer();
      const { session } = await createSandbox(call, { name: "keep-sb" });
      const created = await j(
        await call("POST", `/v2/sandboxes/sessions/${session.id}/snapshot`, {
          body: {},
        }),
      );

      await call("DELETE", "/v2/sandboxes/keep-sb");

      const got = await j(
        await call("GET", `/v2/sandboxes/snapshots/${created.snapshot.id}`),
      );
      expect(got.snapshot.status).toBe("created");
    });

    test("deleting a sandbox with deleteOrphanSnapshots keeps the snapshots a fork still uses", async () => {
      const { call } = makeServer();
      const { session } = await createSandbox(call, { name: "orphan-sb" });
      const orphan = await j(
        await call("POST", `/v2/sandboxes/sessions/${session.id}/snapshot`, {
          body: {},
        }),
      );

      // A second snapshot becomes the sandbox's current one, and the fork
      // restores from it, so only the first snapshot is an orphan.
      const forked = await j(
        await call("POST", `/v2/sandboxes/sessions/${session.id}/snapshot`, {
          body: {},
        }),
      );
      await call("POST", "/v2/sandboxes/orphan-sb/fork", {
        body: { name: "orphan-sb-fork" },
      });

      const res = await call(
        "DELETE",
        "/v2/sandboxes/orphan-sb?deleteOrphanSnapshots=true",
      );
      expect(res.status).toBe(200);

      const deleted = await j(
        await call("GET", `/v2/sandboxes/snapshots/${orphan.snapshot.id}`),
      );
      expect(deleted.snapshot.status).toBe("deleted");

      const kept = await j(
        await call("GET", `/v2/sandboxes/snapshots/${forked.snapshot.id}`),
      );
      expect(kept.snapshot.status).toBe("created");
    });
  });
});
