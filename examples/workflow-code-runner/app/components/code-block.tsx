"use client";

import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

export function CodeBlock({ code, lang = "javascript" }: { code: string; lang?: string }) {
  const [html, setHtml] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    codeToHtml(code, {
      lang,
      theme: "github-dark",
    }).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [code, lang]);

  if (!html) {
    // Fallback while shiki loads
    return (
      <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-[#0d1117] p-4 font-mono text-sm text-zinc-300">
        {code}
      </pre>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-lg border border-zinc-800 [&_pre]:!bg-[#0d1117] [&_pre]:p-4 [&_pre]:text-sm [&_code]:text-sm"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
