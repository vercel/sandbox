"use client";

import { useState } from "react";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<{
    code: string;
    stdout: string;
    stderr: string;
    iterations: number;
  } | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;

    setStatus("running");
    setResult(null);
    setError("");

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();

      const pollResult = async (runId: string) => {
        const poll = await fetch(`/api/run?runId=${runId}`);
        const pollData = await poll.json();

        if (pollData.status === "completed") {
          setResult(pollData.output);
          setStatus("done");
        } else if (pollData.status === "failed") {
          setError(pollData.error ?? "Workflow failed");
          setStatus("error");
        } else {
          setTimeout(() => pollResult(runId), 1000);
        }
      };

      await pollResult(data.runId);
    } catch (err) {
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
            Generating and executing code in sandbox...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-zinc-300">
                  Generated Code
                </h2>
                {result.iterations > 1 && (
                  <span className="text-xs text-zinc-500">
                    {result.iterations} attempt
                    {result.iterations > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 font-mono text-sm text-zinc-300">
                {result.code}
              </pre>
            </div>

            {result.stdout && (
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium text-zinc-300">Output</h2>
                <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 font-mono text-sm text-green-400">
                  {result.stdout}
                </pre>
              </div>
            )}

            {result.stderr && (
              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium text-zinc-300">Stderr</h2>
                <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 font-mono text-sm text-yellow-400">
                  {result.stderr}
                </pre>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
