export const output = {
  print: console.log,
  error: console.error,
  link(text: string, href: string) {
    return `\u001B]8;;${href}\u001B\\${text}\u001B]8;;\u001B\\`;
  },
};
