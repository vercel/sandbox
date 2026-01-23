"use client";

import type React from "react";
import { useChat } from "@ai-sdk/react";
import { useState, useCallback, useRef, useTransition, useEffect } from "react";
import { ChatMessages } from "@/components/chat-messages";
import { ChatInput } from "@/components/chat-input";
import { VirtualizedLogs } from "@/components/virtualized-logs";
import { ResizeHandle } from "@/components/resize-handle";
import { useResizable } from "@/hooks/use-resizable";
import { extractCodeBlocks } from "@/lib/extract-code-blocks";
import { createSandbox, runCommand, uploadFiles } from "@/app/actions";

export default function SplitScreenChatOptimized() {
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [logs, setLogs] = useState<string[]>([]);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [renderPreview, setRenderPreview] = useState(false);
  const isReadyRef = useRef(false);

  const sandboxIdRef = useRef<string | null>(null);
  const sandboxRoutesRef = useRef<{ subdomain: string; port: number }[] | null>(
    null,
  );

  const [url, setSandboxUrl] = useState<string | null>(null);
  const [routes, setRoutes] = useState<
    { subdomain: string; port: number }[] | null
  >(null);

  const {
    leftPanelWidth,
    rightTopHeight,
    handleHMouseDown,
    handleVMouseDown,
    containerRef,
  } = useResizable();

  // State for dynamic height calculation
  const [logsContainerHeight, setLogsContainerHeight] = useState(400);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status } = useChat({
    onFinish(message) {
      const msg = message.message.parts.find((part) => part.type === "text");
      startTransition(async () => {
        if (sandboxIdRef.current && sandboxRoutesRef.current && msg) {
          await uploadFiles({
            files: extractCodeBlocks(msg!.text),
            sandboxId: sandboxIdRef.current,
          });

          if (!isReadyRef.current) {
            isReadyRef.current = true;
            const install = await runCommand({
              sandboxId: sandboxIdRef.current,
              cmd: "npm",
              args: ["install", "--loglevel", "info"],
              detached: true,
            });

            for await (const log of getLogs({
              sandboxId: sandboxIdRef.current,
              cmdId: install.cmdId,
            })) {
              setLogs((prevLogs) => [...prevLogs, log]);
            }

            const next = await runCommand({
              sandboxId: sandboxIdRef.current,
              cmd: "npm",
              args: ["run", "dev"],
              detached: true,
            });
            (async () => {
              if (!sandboxRoutesRef.current || !sandboxIdRef.current) {
                console.error("Sandbox routes or ID is missing");
                return;
              }
              for await (const log of getLogs({
                sandboxId: sandboxIdRef.current,
                cmdId: next.cmdId,
              })) {
                setLogs((prevLogs) => [...prevLogs, log]);
              }
            })();

            await new Promise((resolve) => setTimeout(resolve, 500));
            setRenderPreview(true);
          }
        } else {
          throw new Error("Unexpected missing sandbox");
        }
      });
    },
    onError(error) {
      console.error("Error communicating with AI:", error);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage({ text: input });
    setInput("");
  };

  const handleFormSubmit = useCallback(
    (event: React.FormEvent) => {
      if (!sandboxId || !url || !routes) {
        startTransition(async () => {
          const { id, url, routes } = await createSandbox();
          setSandboxUrl(url);
          setRoutes(routes);
          setSandboxId(id);
          sandboxIdRef.current = id;
          sandboxRoutesRef.current = routes;
        });
      }
      return handleSubmit(event);
    },
    [sandboxId, url, routes, handleSubmit],
  );

  const handleReload = useCallback(() => {
    setRenderPreview(false);
    startTransition(async () => {
      setRenderPreview(true);
    });
  }, []);

  // Calculate logs container height dynamically
  useEffect(() => {
    const updateHeight = () => {
      if (logsContainerRef.current) {
        const containerRect = logsContainerRef.current.getBoundingClientRect();
        const availableHeight = containerRect.height;
        setLogsContainerHeight(availableHeight);
      }
    };

    // Update height on mount and resize
    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    if (logsContainerRef.current) {
      resizeObserver.observe(logsContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [rightTopHeight]); // Re-run when panel height changes

  return (
    <div ref={containerRef} className="h-screen flex relative">
      {/* Left Side - Chat UI */}
      <div
        className="flex flex-col border-r border-gray-200"
        style={{ width: `${leftPanelWidth}%` }}
      >
        <div className="border-b p-4 flex-shrink-0">AI Assistant</div>

        <ChatMessages
          messages={messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            parts: msg.parts.map((part) => ({
              type: part.type,
              text: part.type === "text" ? part.text : "",
            })),
          }))}
          status={status}
        />

        <ChatInput
          input={input}
          onInputChange={(e) => setInput(e.target.value)}
          onSubmit={handleFormSubmit}
          disabled={status === "streaming"}
        />
      </div>

      <ResizeHandle direction="horizontal" onMouseDown={handleHMouseDown} />

      {/* Right Side - Split into iframe and logs */}
      <div
        className="flex flex-col h-screen"
        style={{ width: `${100 - leftPanelWidth}%` }}
      >
        {/* Top Half - iframe */}
        <div
          className="border-b border-gray-200 flex flex-col"
          style={{ height: `${rightTopHeight}%` }}
        >
          <div className="border-b p-4 flex-shrink-0 flex items-center justify-between">
            <span>Preview {renderPreview ? `(${url})` : ""}</span>
            <button
              onClick={handleReload}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Reload
            </button>
          </div>
          {renderPreview && url && (
            <iframe
              src={url}
              className="w-full flex-1 border-0"
              title="Preview Frame"
            />
          )}
        </div>

        <ResizeHandle direction="vertical" onMouseDown={handleVMouseDown} />

        {/* Bottom Half - Logs */}
        <div className="flex-1 flex flex-col h-0 min-h-0">
          <div className="border-b p-4 flex-shrink-0">System Logs</div>
          <div ref={logsContainerRef} className="flex-1 min-h-0">
            <VirtualizedLogs logs={logs} height={logsContainerHeight} />
          </div>
        </div>
      </div>
    </div>
  );
}

async function* getLogs(params: { cmdId: string; sandboxId: string }) {
  const response = await fetch("/api/logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let line = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    line += decoder.decode(value, { stream: true });
    const lines = line.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i]) yield lines[i];
    }
    line = lines[lines.length - 1];
  }
}
