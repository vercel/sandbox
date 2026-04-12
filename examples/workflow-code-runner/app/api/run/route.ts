import { start, getRun } from "workflow/api";
import { runCode } from "@/workflows/code-runner";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { prompt, runtime } = await request.json();

  const run = await start(runCode, [prompt, runtime]);

  return NextResponse.json({ runId: run.runId });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");
  const stream = searchParams.get("stream");

  if (!runId) {
    return NextResponse.json({ error: "Missing runId" }, { status: 400 });
  }

  const run = getRun(runId);

  // Stream stdout, stderr, or status as SSE
  if (stream === "stdout" || stream === "stderr" || stream === "status") {
    const readable = run.getReadable<string>({ namespace: stream });
    const encoder = new TextEncoder();

    const sseStream = new ReadableStream({
      async start(controller) {
        try {
          const reader = readable.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
            );
          }
          controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
          controller.close();
        } catch {
          controller.close();
        }
      },
    });

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Poll for status
  const status = await run.status;

  if (status === "completed") {
    const output = await run.returnValue;
    return NextResponse.json({ status, output });
  }

  return NextResponse.json({ status });
}
