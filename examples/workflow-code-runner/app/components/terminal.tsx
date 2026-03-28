"use client";

import Ansi from "ansi-to-react";
import { useEffect, useRef } from "react";

export function Terminal({
  title,
  children,
  variant = "default",
}: {
  title: string;
  children: string;
  variant?: "default" | "error";
}) {
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [children]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/80 px-4 py-2">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        </div>
        <span className="ml-2 text-xs text-zinc-500">{title}</span>
      </div>
      <pre
        ref={scrollRef}
        className={`flex-1 overflow-auto bg-[#0d1117] p-4 font-mono text-sm leading-relaxed ${
          variant === "error" ? "text-red-400" : "text-zinc-300"
        }`}
      >
        <Ansi>{children}</Ansi>
      </pre>
    </div>
  );
}
