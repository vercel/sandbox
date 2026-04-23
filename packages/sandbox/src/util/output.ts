import { formatDistanceStrict } from "date-fns/formatDistanceStrict";
import chalk, { ChalkInstance } from "chalk";
import { stripVTControlCharacters } from "node:util";

export const output = {
  print: console.log,
  error: console.error,
  link(text: string, href: string) {
    return `\u001B]8;;${href}\u001B\\${text}\u001B]8;;\u001B\\`;
  },
};

export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value < 10 && unitIndex > 0 ? 1 : 0,
  });
  return `${formatter.format(value)} ${units[unitIndex]}`;
}

export function timeAgo(date: string | number | Date | undefined) {
  if (date === undefined) {
    return '-';
  }

  return formatDistanceStrict(date, new Date(), {
    addSuffix: true,
  });
}

export function table<T extends object>(opts: {
  rows: T[];
  columns: Record<
    string,
    {
      value: (row: T) => string | number;
      color?: (row: T) => ChalkInstance;
    }
  >;
}) {
  const titles = Object.keys(opts.columns);
  const visibleLength = (value: string) =>
    stripVTControlCharacters(value).length;
  const maxWidths: number[] = titles.map((title) => visibleLength(title));
  const data = opts.rows.map((row) => {
    return titles.map((title, i) => {
      let value = String(opts.columns[title].value(row));
      const width = visibleLength(value);
      if (width > maxWidths[i]) {
        maxWidths[i] = width;
      }
      if (opts.columns[title].color) {
        value = opts.columns[title].color(row)(value);
      }
      return value;
    });
  });
  const padded = (value: string, i: number) => {
    const padding = maxWidths[i] - visibleLength(value);
    return padding > 0 ? `${value}${" ".repeat(padding)}` : value;
  };
  const space = "   ";
  return [
    chalk.bold(titles.map(padded).join(space)),
    ...data.map((row) => row.map(padded).join(space)),
  ].join("\n");
}

export function formatRunDuration(d: number): string {
  if (d < 1000) {
    return `${d}ms`;
  }
  return `${d/1000}s`
}

type FlagValue = string | number | boolean | string[] | undefined;

export function formatNextCursorHint(
  command: string,
  flags: Record<string, FlagValue>,
  cursor: string,
  positionals: string[] = [],
): string {
  const parts = [command, ...positionals.map(shellEscape)];
  for (const [name, value] of Object.entries(flags)) {
    if (value === undefined || value === false) {
      continue;
    }

    if (value === true) {
      parts.push(`--${name}`);
    } else if (Array.isArray(value)) {
      for (const v of value) {
        parts.push(`--${name}`, shellEscape(v));
      }
    } else {
      parts.push(`--${name}`, shellEscape(String(value)));
    }
  }

  parts.push("--cursor", shellEscape(cursor));
  return `More results: ${parts.join(" ")}`;
}

function shellEscape(value: string): string {
  if (/^[\w\-.:/=@]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}