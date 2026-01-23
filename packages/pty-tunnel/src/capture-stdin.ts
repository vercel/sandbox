import readline from "node:readline";
import { type Message } from "./messages.ts";

export function captureStdin({
  redirectTo,
}: {
  redirectTo: { sendMessage(message: Message): void };
}): () => void {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.on("exit", () => {
    process.stdin.setRawMode(false);
  });
  process.stdin.on("data", (chunk) => {
    try {
      redirectTo.sendMessage({
        type: "message",
        message: String(chunk),
      });
    } catch {}
  });

  return () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.end();
  };
}
