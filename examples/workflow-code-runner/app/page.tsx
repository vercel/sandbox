"use client";

import { useState, useRef } from "react";
import type { RunCodeResult } from "@/workflows/code-runner";
import { CodeBlock } from "./components/code-block";
import { Terminal } from "./components/terminal";

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
  const [code, setCode] = useState("");
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");
  const [phase, setPhase] = useState<{
    phase: Phase;
    attempt: number;
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
    setCode("");
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
        const data = JSON.parse(JSON.parse(e.data));
        setPhase({ phase: data.phase, attempt: data.attempt });
        if (data.code) {
          setCode(data.code);
        }
      };

      const cleanup = () => {
        stdoutSource.close();
        stderrSource.close();
        statusSource.close();
      };

      stdoutSource.addEventListener("done", cleanup);
      stderrSource.addEventListener("done", cleanup);
      statusSource.addEventListener("done", cleanup);

      const pollResult = async () => {
        const poll = await fetch(`/api/run?runId=${runId}`);
        const data = await poll.json();

        if (data.status === "completed") {
          cleanup();
          const output = data.output as RunCodeResult;
          setResult(output);
          setCode(output.code);
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

  const showPanes = code || stdout || stderr;

  return (
    <div className="flex min-h-screen flex-col font-sans">
      {/* Top bar: prompt + status */}
      <div className="border-b border-zinc-800 px-6 py-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">
              Sandbox Code Runner
            </h1>
            <p className="text-sm text-zinc-500">
              Describe a program and AI will generate and execute it in a
              sandbox.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex gap-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.metaKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Describe a program to run..."
              rows={1}
              className="flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600"
            />
            <button
              type="submit"
              disabled={status === "running" || !prompt.trim()}
              className="rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "running" ? "Running..." : "Run"}
            </button>
          </form>

          {status === "running" && phase && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-300" />
              {PHASE_LABELS[phase.phase]}
              {phase.attempt > 0 && ` (attempt ${phase.attempt}/3)`}
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
        </div>
      </div>

      {/* Split panes */}
      {showPanes && (
        <div className="flex flex-1">
          {/* Left pane: code */}
          <div className="flex w-1/2 flex-col border-r border-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
              <span className="text-xs font-medium text-zinc-400">
                script.js
              </span>
              {result && (
                <span className="text-xs text-zinc-500">
                  {result.iterations} attempt
                  {result.iterations > 1 ? "s" : ""}
                  {result.success ? (
                    <span className="ml-1.5 text-green-500">passed</span>
                  ) : (
                    <span className="ml-1.5 text-red-500">failed</span>
                  )}
                </span>
              )}
              {!result && phase && phase.attempt > 0 && (
                <span className="text-xs text-zinc-500">
                  attempt {phase.attempt}/3
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              {code && <CodeBlock code={code} />}
            </div>
          </div>

          {/* Right pane: terminal output */}
          <div className="flex w-1/2 flex-col">
            {stdout && (
              <div className="flex flex-1 flex-col border-b border-zinc-800">
                <Terminal title="stdout">{stdout}</Terminal>
              </div>
            )}
            {stderr && (
              <div className="flex flex-1 flex-col">
                <Terminal title="stderr" variant="error">
                  {stderr}
                </Terminal>
              </div>
            )}
            {!stdout && !stderr && status === "running" && (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
                Waiting for output...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
