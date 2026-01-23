export type Message =
  | {
      type: "message";
      message: string;
    }
  | { type: "resize"; cols: number; rows: number }
  | { type: "ready" };

export function parse(buf: Buffer): Message | null {
  switch (buf.at(0)) {
    case 0: {
      // message
      return { type: "message", message: buf.subarray(1).toString("utf-8") };
    }
    case 1: {
      // resize
      // must be at least 5 bytes
      if (buf.length < 5) return null;
      const cols = buf.readUInt16BE(1);
      const rows = buf.readUInt16BE(3);
      return { type: "resize", cols, rows };
    }
    case 2: {
      // ready
      return { type: "ready" };
    }
  }
  return null;
}

export function serialize(msg: Message): Buffer {
  switch (msg.type) {
    case "message": {
      const messageBuf = Buffer.from(msg.message, "utf-8");
      const buf = Buffer.alloc(1 + messageBuf.length);
      buf.writeUInt8(0, 0);
      messageBuf.copy(buf, 1);
      return buf;
    }
    case "resize": {
      const buf = Buffer.alloc(5);
      buf.writeUInt8(1, 0);
      buf.writeUInt16BE(msg.cols, 1);
      buf.writeUInt16BE(msg.rows, 3);
      return buf;
    }
    case "ready": {
      const buf = Buffer.alloc(1);
      buf.writeUInt8(2, 0);
      return buf;
    }
  }
}
