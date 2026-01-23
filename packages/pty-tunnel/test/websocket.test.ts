import {
  describe,
  expect,
  onTestFailed,
  onTestFinished,
  test,
  vi,
} from "vitest";
import { spawn } from "node:child_process";
import * as Messages from "../src/messages";
import { createListener, ListenerSocket } from "../src/websocket";
import { type Readable } from "node:stream";
import { isArrayBuffer } from "node:util/types";
import { once } from "node:events";

function testStream(stream: Readable) {
  const buffer = [] as Buffer[];
  onTestFailed(() => {
    const output = Buffer.concat(buffer).toString("utf-8");
    console.log("=== Process stderr ===");
    console.log(output);
    console.log(`=== End stderr (${new Date().toISOString()}) ===`);
  });
  stream.on("data", (chunk) => {
    buffer.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  return buffer;
}

async function startClient(opts: {
  cols: number;
  rows: number;
  mode: "client" | "single";
  inactivityDeadline?: `${number}s`;
  cmd?: [string, ...string[]];
}) {
  const listener = createListener();
  const url = new URL(
    "../../pty-tunnel-server/pty-tunnel-server",
    import.meta.url,
  );
  const proc = spawn(
    url.pathname,
    [
      "--debug",
      `--mode=${opts.mode}`,
      `--cols=${opts.cols}`,
      `--rows=${opts.rows}`,
      ...(!opts.inactivityDeadline
        ? []
        : [`--inactivity-deadline=${opts.inactivityDeadline}`]),
      ...(opts.cmd || ["sh"]),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stderrBuffer = testStream(proc.stderr);
  proc.stdout.pipe(listener.stdoutStream);
  onTestFinished(() => {
    proc.kill();
  });

  const conn = await listener.connection;
  onTestFinished(() => {
    try {
      process.kill(conn.serverProcessId);
    } catch {}
    try {
      process.kill(conn.processId);
    } catch {}
  });
  let processWs: ListenerSocket | undefined;
  const qs = new URLSearchParams({
    processId: String(conn.processId),
    token: conn.token,
  });

  return {
    proc,
    stderrBuffer,
    ...conn,
    get processWs() {
      if (!processWs) {
        const url = `ws://localhost:${conn.port}/ws/process?${qs}`;
        processWs = new ListenerSocket(url);
      }
      return processWs;
    },
  };
}

function slurpMessages(ws: ListenerSocket) {
  const raw = [] as Buffer[];
  const messages = [] as (Messages.Message | null)[];
  ws.addEventListener("message", async ({ data }) => {
    let buf: Buffer;
    if (Buffer.isBuffer(data)) {
      buf = data as Buffer;
    } else if (data instanceof Blob) {
      buf = Buffer.from(await data.bytes());
    } else if (Array.isArray(data)) {
      buf = Buffer.concat(data);
    } else if (isArrayBuffer(data)) {
      buf = Buffer.from(data);
    } else {
      buf = Buffer.from(data);
    }
    raw.push(buf);
    messages.push(Messages.parse(buf));
  });
  return [messages, raw] as const;
}

for (const mode of ["client", "single"] as const) {
  describe(`mode=${mode}`, () => {
    test("over websocket", async () => {
      const client = await startClient({ cols: 80, rows: 30, mode });
      expect(client.serverProcessId).toBeGreaterThan(0);
      expect(client.processId).toBeGreaterThan(0);
      expect(
        client.serverProcessId == client.processId,
        `expected ports to match mode:${mode} (${client.serverProcessId}, ${client.processId})`,
      ).toEqual(mode === "single");

      const [clientWs, clientMessages] = await vi.waitFor(async () => {
        const clientWs = client.createClient(`ws://localhost:${client.port}`);
        const [, clientMessages] = slurpMessages(clientWs);
        await clientWs.waitForOpen();
        return [clientWs, clientMessages];
      });

      clientWs.sendMessage({ type: "ready" });

      await vi.waitFor(async () => {
        const text = clientMessages.map((x) => x.toString()).join("");
        const hex = Buffer.from(text).toString("hex");
        expect(
          text,
          `Failed to find "$ " in the output string. The full hex output is ${hex}`,
        ).toContain("$ ");
      });

      clientWs.sendMessage({
        type: "message",
        message: `echo "hello from $0 over ws"\r`,
      });

      await vi.waitFor(async () => {
        const text = clientMessages.map((x) => x.toString()).join("");
        expect(text).toContain("hello from sh over ws");
      });

      clientWs.sendMessage({
        type: "message",
        message: `exit\r`,
      });

      await new Promise<void>((resolve, reject) => {
        clientWs.addEventListener("close", () => resolve(), { once: true });
        clientWs.addEventListener("error", (err) => reject(err), {
          once: true,
        });
      });
    });

    test("again", async () => {
      const client = await startClient({ cols: 80, rows: 30, mode });

      const [clientWs, clientMessages] = await vi.waitFor(async () => {
        const clientWs = client.createClient(`ws://localhost:${client.port}`);
        const [, clientMessages] = slurpMessages(clientWs);
        await clientWs.waitForOpen();
        return [clientWs, clientMessages];
      });

      clientWs.sendMessage({ type: "ready" });

      await vi.waitFor(async () => {
        const text = clientMessages.map((x) => x.toString()).join("");
        const hex = Buffer.from(text).toString("hex");
        expect(
          text,
          `Failed to find "$ " in the output string. The full hex output is ${hex}`,
        ).toContain("$ ");
      });

      clientWs.sendMessage({
        type: "message",
        message: `echo "hello from $0 over ws"\r`,
      });

      await vi.waitFor(async () => {
        const text = clientMessages.map((x) => x.toString()).join("");
        expect(text).toContain("hello from sh over ws");
      });

      clientWs.sendMessage({
        type: "message",
        message: `exit\r`,
      });

      await new Promise<void>((resolve, reject) => {
        clientWs.addEventListener("close", () => resolve(), { once: true });
        clientWs.addEventListener("error", (err) => reject(err), {
          once: true,
        });
      });
    });

    test("disconnects after inactivity deadline reaches", async () => {
      const client = await startClient({
        cols: 80,
        rows: 30,
        mode,
        inactivityDeadline: "1s",
      });
      const startTime = performance.now();
      await vi.waitFor(
        () => {
          expect(Buffer.concat(client.stderrBuffer).toString()).toContain(
            "inactivity timeout waiting for remote connection",
          );
        },
        { timeout: 3_000 },
      );
      await vi.waitFor(
        () => {
          expect(() => {
            process.kill(client.processId, 0);
          }).toThrow();
        },
        { interval: 100, timeout: 1_000 },
      );
      const endTime = performance.now();
      expect(endTime - startTime).toBeGreaterThanOrEqual(1_000);
    });

    test("prints hello with echo, not interactive", async () => {
      const client = await startClient({
        cols: 80,
        rows: 30,
        mode,
        cmd: ["echo", "vercel is triangle"],
      });
      const [clientWs, clientMessages] = await vi.waitFor(async () => {
        const clientWs = client.createClient(`ws://localhost:${client.port}`);
        const [, clientMessages] = slurpMessages(clientWs);
        await clientWs.waitForOpen();
        return [clientWs, clientMessages];
      });

      clientWs.sendMessage({ type: "ready" });
      await vi.waitFor(
        async () => {
          const text = clientMessages.map((x) => x.toString()).join("");
          const hex = Buffer.from(text).toString("hex");
          expect(
            text,
            `Failed to find "vercel is triangle" in the output string. The full hex output is ${hex}`,
          ).toContain("vercel is triangle");
        },
        { timeout: 3_000 },
      );
      await new Promise((resolve) =>
        clientWs.addEventListener("close", resolve),
      );
      await vi.waitFor(
        () => {
          expect(() => {
            process.kill(client.processId, 0);
          }).toThrow();
        },
        { interval: 100, timeout: 1_000 },
      );
    });

    test("disconnects if can't start process (no executable found)", async () => {
      const client = await startClient({
        cols: 80,
        rows: 30,
        mode,
        cmd: ["nonexistent-command-xyz"],
      });
      await vi.waitFor(() => {
        expect(Buffer.concat(client.stderrBuffer).toString()).toContain(
          "executable file not found in $PATH",
        );
      });
      await vi.waitFor(
        () => {
          expect(() => {
            process.kill(client.processId, 0);
          }).toThrow();
        },
        { interval: 100, timeout: 1_000 },
      );
    });
  });
}
