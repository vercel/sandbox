"use client";

import { useState, useRef } from "react";
import type { RunCodeResult } from "@/workflows/code-runner";

type Phase =
  | "creating-sandbox"
  | "generating"
  | "fixing"
  | "writing"
  | "running"
  | "stopping";

const PHASE_LABELS: Record<Phase, string> = {
  "creating-sandbox": "Creating sandbox",
  generating: "Generating code",
  fixing: "Fixing code",
  writing: "Writing files to sandbox",
  running: "Running in sandbox",
  stopping: "Stopping sandbox",
};

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<RunCodeResult | null>(null);
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");
  const [phase, setPhase] = useState<{
    phase: Phase;
    attempt: number;
    code?: string;
  } | null>(null);
  const [status, setStatus] = useState<
    "idle" | "running" | "done" | "failed" | "error"
  >("idle");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;

    setStatus("running");
    setResult(null);
    setStdout("");
    setStderr("");
    setPhase(null);
    setError("");

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(await res.text());

      const { runId } = await res.json();

      // Subscribe to stdout, stderr, and status streams
      const stdoutSource = new EventSource(
        `/api/run?runId=${runId}&stream=stdout`,
      );
      const stderrSource = new EventSource(
        `/api/run?runId=${runId}&stream=stderr`,
      );
      const statusSource = new EventSource(
        `/api/run?runId=${runId}&stream=status`,
      );

      stdoutSource.onmessage = (e) => {
        setStdout((prev) => prev + JSON.parse(e.data));
      };
      stderrSource.onmessage = (e) => {
        setStderr((prev) => prev + JSON.parse(e.data));
      };
      statusSource.onmessage = (e) => {
        setPhase(JSON.parse(JSON.parse(e.data)));
      };

      const cleanup = () => {
        stdoutSource.close();
        stderrSource.close();
        statusSource.close();
      };

      stdoutSource.addEventListener("done", cleanup);
      stderrSource.addEventListener("done", cleanup);
      statusSource.addEventListener("done", cleanup);

      // Poll for completion
      const pollResult = async () => {
        const poll = await fetch(`/api/run?runId=${runId}`);
        const data = await poll.json();

        if (data.status === "completed") {
          cleanup();
          const output = data.output as RunCodeResult;
          setResult(output);
          setPhase(null);
          setStatus(output.success ? "done" : "failed");
        } else if (data.status === "failed") {
          cleanup();
          setPhase(null);
          setError("Workflow failed unexpectedly");
          setStatus("error");
        } else {
          setTimeout(pollResult, 1000);
        }
      };

      await pollResult();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center font-sans">
      <main className="flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Sandbox Code Runner
          </h1>
          <p className="text-sm text-zinc-400">
            Describe a program and AI will generate and execute it in a sandbox.
            If it fails, it automatically retries with the error context.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder='e.g. "Write a program that computes the first 20 fibonacci numbers and prints them as a formatted table"'
            rows={3}
            className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600"
          />
          <button
            type="submit"
            disabled={status === "running" || !prompt.trim()}
            className="self-start rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "running" ? "Running..." : "Run"}
          </button>
        </form>

        {status === "running" && (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
            {phase
              ? `${PHASE_LABELS[phase.phase]}...${phase.attempt > 0 ? ` (attempt ${phase.attempt}/${3})` : ""}`
              : "Starting..."}
          </div>
        )}

        {status === "error" && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {result && !result.success && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
            Code failed after {result.iterations} attempt
            {result.iterations > 1 ? "s" : ""}: {result.error}
          </div>
        )}

        {(stdout || stderr || result || phase?.code) && (
          <div className="flex flex-col gap-4">
            {(result || phase?.code) && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-zinc-300">
                    Generated Code
                  </h2>
                  {result && (
                    <span className="text-xs text-zinc-500">
                      {result.iterations} attempt
                      {result.iterations > 1 ? "s" : ""}
                      {result.success ? (
                        <span className="ml-2 text-green-500">passed</span>
                      ) : (
                        <span className="ml-2 text-red-500">failed</span>
                      )}
                    </span>
                  )}
                  {!result && phase && (
                    <span className="text-xs text-zinc-500">
                      attempt {phase.attempt}/{3}
                    </span>
                  )}
                </div>
                <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 font-mono text-sm text-zinc-300">
                  {result?.code ?? phase?.code}
                </pre>
              </div>
            )}

            {stdout && (
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium text-zinc-300">Output</h2>
                <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 font-mono text-sm text-green-400">
                  {stdout}
                </pre>
              </div>
            )}

            {stderr && (
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium text-zinc-300">Stderr</h2>
                <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 font-mono text-sm text-yellow-400">
                  {stderr}
                </pre>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
