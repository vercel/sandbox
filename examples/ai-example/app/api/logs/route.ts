import { Sandbox } from "@vercel/sandbox";

export const maxDuration = 120;

export async function POST(request: Request) {
  const body = await request.json();
  const cmdId = body.cmdId;
  const sandboxName = body.sandboxName;

  if (!cmdId || !sandboxName) {
    return new Response("Missing required parameters", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sandbox = await Sandbox.get({ name: sandboxName });
      const command = await sandbox.getCommand(cmdId);

      for await (const log of command.logs()) {
        controller.enqueue(encoder.encode(log.data));
      }

      console.log("Command finished, exiting stream");
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain",
      "Transfer-Encoding": "chunked",
    },
  });
}
