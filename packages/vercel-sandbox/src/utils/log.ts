import pico from "picocolors";
const colors = {
  warn: pico.yellow,
  error: pico.red,
  success: pico.green,
  info: pico.blue,
};
const logPrefix = pico.dim("[vercel/sandbox]");
export function write(
  level: "warn" | "error" | "info" | "success",
  text: string | string[],
) {
  text = Array.isArray(text) ? text.join("\n") : text;
  const prefixed = text.replace(/^/gm, `${logPrefix} `);
  console.error(colors[level](prefixed));
}

export function code(text: string) {
  return pico.italic(pico.dim("`") + text + pico.dim("`"));
}
