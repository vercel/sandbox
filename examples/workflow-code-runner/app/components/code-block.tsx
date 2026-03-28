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
      theme: "github-dark-default",
    }).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (!html) {
    return (
      <pre className="line-numbers bg-black p-4 font-mono text-sm leading-relaxed text-[#e6edf3]">
        {code.split("\n").map((line, i) => (
          <div key={i} className="table-row">
            <span className="table-cell w-8 select-none pr-4 text-right tabular-nums text-[#484f58]">
              {i + 1}
            </span>
            <span className="table-cell">{line}</span>
          </div>
        ))}
      </pre>
    );
  }

  return (
    <div
      className="code-block [&_pre]:!bg-black [&_pre]:p-4 [&_pre]:leading-relaxed [&_pre]:text-sm [&_code]:text-sm [&_code]:leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
