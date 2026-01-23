import { unified } from "unified";
import { visit } from "unist-util-visit";
import remarkParse from "remark-parse";

interface ExtractedFile {
  path: string;
  content: string;
  lang: string;
}

export function extractCodeBlocks(markdown: string): ExtractedFile[] {
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
