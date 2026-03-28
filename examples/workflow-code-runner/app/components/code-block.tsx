"use client";

import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

export function CodeBlock({
  code,
  lang = "javascript",
}: {
  code: string;
  lang?: string;
}) {
  const [html, setHtml] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    codeToHtml(code, {
      lang,
      theme: "github-dark",
    }).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (!html) {
    return (
      <pre className="bg-[#0d1117] p-4 font-mono text-sm leading-relaxed text-zinc-300">
        {code}
      </pre>
    );
  }

  return (
    <div
      className="[&_pre]:!bg-[#0d1117] [&_pre]:p-4 [&_pre]:leading-relaxed [&_pre]:text-sm [&_code]:text-sm"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
