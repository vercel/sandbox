import { formatDistance } from "date-fns/formatDistance";
import chalk, { ChalkInstance } from "chalk";

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

  return formatDistance(date, new Date(), {
    addSuffix: true,
  })
    .replace("about ", "")
    .replace("less than ", "");
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
  const maxWidths: number[] = titles.map((title) => title.length);
  const data = opts.rows.map((row) => {
    return titles.map((title, i) => {
      let value = String(opts.columns[title].value(row));
      if (value.length > maxWidths[i]) {
        maxWidths[i] = value.length;
      }
      if (opts.columns[title].color) {
        value = opts.columns[title].color(row)(value);
      }
      return value;
    });
  });
  const padded = (t: string, i: number) => t.padEnd(maxWidths[i], " ");
  const space = "   ";
  return [
    chalk.bold(titles.map(padded).join(space)),
    ...data.map((row) => row.map(padded).join(space)),
  ].join("\n");
}
