"use server";

import { gateway } from "@/lib/gateway";
import { streamText } from "ai";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import remarkParse from "remark-parse";

const SYSTEM_PROMPT = `
You are an AI asistant that buils web applications based on the user input. 
You must include configuration files, package.json, etc.
Everything needed to run the application should be included.
Show the files using custom code blocks with the following format:
  \`\`\`<type here> file="path/to/file.js"
  <Your code here>
  \`\`\`
`;

export async function getAIResponse(prompt: string) {
  const { textStream } = streamText({
    messages: [{ role: "user", content: prompt }],
    model: gateway("anthropic/claude-4-sonnet-20250514"),
    system: SYSTEM_PROMPT,
    onError: (error) => {
      console.error("Error communicating with AI", error);
      error = error;
    },
  });

  let result: string = "";
  for await (const partial of textStream) {
    console.log("Text stream partial:", partial);
    result += partial;
  }

  return { files: extractCodeBlocks(result) };
}

interface ExtractedFile {
  path: string;
  content: string;
  lang: string;
}

function extractCodeBlocks(markdown: string): ExtractedFile[] {
  const tree = unified().use(remarkParse).parse(markdown);
  const files: ExtractedFile[] = [];
  visit(tree, "code", (node: any) => {
    const { lang, meta, value } = node;
    if (meta) {
      const match = meta.match(/file="([^"]+)"/);
      if (match) {
        files.push({
          path: match[1],
          content: value,
          lang: lang || "plaintext",
        });
      }
    }
  });
  return files;
}
