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
      <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.1)] bg-black px-4 py-2">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-[#484f58]" />
          <div className="h-2.5 w-2.5 rounded-full bg-[#484f58]" />
          <div className="h-2.5 w-2.5 rounded-full bg-[#484f58]" />
        </div>
        <span className="ml-2 text-xs text-[#484f58]">{title}</span>
      </div>
      <pre
        ref={scrollRef}
        className={`flex-1 overflow-auto bg-black p-4 font-mono text-sm leading-relaxed ${
          variant === "error" ? "text-[#f85149]" : "text-[#e6edf3]"
        }`}
      >
        <Ansi>{children}</Ansi>
      </pre>
    </div>
  );
}
