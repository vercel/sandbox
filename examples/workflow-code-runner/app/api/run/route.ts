import { start, getRun } from "workflow/api";
import { runCode } from "@/workflows/code-runner";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { prompt } = await request.json();

  const run = await start(runCode, [prompt]);

  return NextResponse.json({ runId: run.runId });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");

  if (!runId) {
    return NextResponse.json({ error: "Missing runId" }, { status: 400 });
  }

  const run = getRun(runId);
  const status = await run.status;

  if (status === "completed") {
    const output = await run.returnValue;
    return NextResponse.json({ status, output });
  }

  return NextResponse.json({ status });
}
