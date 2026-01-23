/**
 * Mock implementation of picocolors for testing purposes
 * Each color function wraps the input string with HTML-like tags
 * e.g., red('text') => '<red>text</red>'
 */
export default new Proxy(
  {},
  {
    get(_, prop: string) {
      return (str: string) => `<${prop}>${str}</${prop}>`;
    },
  },
);
