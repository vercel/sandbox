export const defaultShell = {
  command: "sh",
  args: [
    "-ic",
    "if command -v bash >/dev/null 2>&1; then exec bash --norc -i; else exec sh -i; fi",
  ],
};
