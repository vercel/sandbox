import { parse, Parser } from "jsonlines";
import * as Messages from "./messages.js";
import type { Writable } from "node:stream";
import { WebSocket } from "ws";

export interface Connection {
  port: number;
  token: string;
  processId: number;
  serverProcessId: number;
  createClient(origin: `${"ws" | "wss"}://${string}`): ListenerSocket;
}

async function readConnectionInfo(stream: Parser): Promise<{
  port: number;
  processId: number;
  token: string;
  serverProcessId: number;
}> {
  try {
    for await (const msg of stream) {
      if (
        msg &&
        typeof msg.port === "number" &&
        typeof msg.token === "string" &&
        typeof msg.processId === "number" &&
        typeof msg.serverProcessId === "number"
      ) {
        return msg;
      }
    }

    throw new Error("Did not receive port and token from server");
  } finally {
    stream.end();
    stream.destroy();
  }
}

export function createListener(): {
  connection: Promise<Connection>;
  stdoutStream: Writable;
} {
  const controlFd = parse();
  return {
    stdoutStream: controlFd,
    connection: (async () => {
      const info = await readConnectionInfo(controlFd);

      const qs = new URLSearchParams({
        processId: String(info.processId),
        token: info.token,
      });

      return {
        port: info.port,
        token: info.token,
        processId: info.processId,
        serverProcessId: info.serverProcessId,
        createClient(origin: `${"ws" | "wss"}://${string}`) {
          return new ListenerSocket(`${origin}/ws/client?${qs}`);
        },
      };
    })(),
  };
}

export type Listener = ReturnType<typeof createListener>;

/**
 * A typed WebSocket that can send and receive pty-tunnel messages.
 */
export class ListenerSocket extends WebSocket {
  async waitForOpen(): Promise<this> {
    await waitForOpen(this);
    return this;
  }
  sendMessage(message: Messages.Message): void {
    return this.send(Messages.serialize(message));
  }
}

async function waitForOpen(ws: WebSocket) {
  let release: (() => void) | undefined;
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
    ws.addEventListener("close", reject, { once: true });
    release = () => {
      ws.removeEventListener("open", resolve);
      ws.removeEventListener("error", reject);
      ws.removeEventListener("close", reject);
    };
  });
  release?.();
}
