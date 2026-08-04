import { randomUUID } from "node:crypto";
import type { IFileSystem } from "just-bash";

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;

const enoent = (tool: string, path: string): CommandOutput => ({
  stdout: "",
  stderr: `${tool}: cannot access '${path}': No such file or directory\n`,
  exitCode: 1,
});

function formatStat(
  stats: { isDirectory: boolean; isSymbolicLink: boolean; mode: number; size: number; mtime: Date },
  format: string,
): string {
  const typeBits = stats.isDirectory ? S_IFDIR : stats.isSymbolicLink ? S_IFLNK : S_IFREG;
  const rawMode = typeBits | (stats.mode & 0o7777);
  const seconds = Math.floor(stats.mtime.getTime() / 1000);
  const tokens: Record<string, string> = {
    "%s": String(stats.size),
    "%f": rawMode.toString(16),
    "%u": "0",
    "%g": "0",
    "%X": String(seconds),
    "%Y": String(seconds),
    "%Z": String(seconds),
    "%W": String(seconds),
    "%h": "1",
    "%i": "0",
    "%d": "0",
    "%B": "512",
    "%b": String(Math.ceil(stats.size / 512)),
  };
  return format.replace(/%[sfugXYZWhidBb]/g, (tok) => tokens[tok] ?? tok);
}

/**
 * The real SDK's `FileSystem` shells out to coreutils with GNU-specific flags
 * (`stat -L -c`, `find -printf`, `truncate`, `mktemp`, `realpath`, `test`) that
 * just-bash either lacks or implements without those options. Intercept exactly
 * those invocations and answer them directly from the in-memory filesystem;
 * everything else falls through to just-bash. Returns `null` when not handled.
 */
export async function tryFsCommand(
  fs: IFileSystem,
  cwd: string,
  command: string,
  args: string[],
): Promise<CommandOutput | null> {
  const abs = (p: string) => fs.resolvePath(cwd, p);
  const last = args[args.length - 1];

  if (command === "stat" && args.includes("-c")) {
    const format = args[args.indexOf("-c") + 1];
    const follow = args.includes("-L");
    try {
      const stats = follow ? await fs.stat(abs(last)) : await fs.lstat(abs(last));
      return { stdout: `${formatStat(stats, format)}\n`, stderr: "", exitCode: 0 };
    } catch {
      return enoent("stat", last);
    }
  }

  if (command === "find" && args.includes("-printf")) {
    const path = args[0];
    try {
      const entries = fs.readdirWithFileTypes
        ? await fs.readdirWithFileTypes(abs(path))
        : (await fs.readdir(abs(path))).map((name) => ({
            name,
            isDirectory: false,
            isSymbolicLink: false,
          }));
      const lines = entries.map(
        (e) => `${e.name}|${e.isDirectory ? "d" : e.isSymbolicLink ? "l" : "f"}`,
      );
      return { stdout: lines.length ? `${lines.join("\n")}\n` : "", stderr: "", exitCode: 0 };
    } catch {
      return enoent("find", path);
    }
  }

  if (command === "truncate") {
    const len = Number.parseInt(args[args.indexOf("-s") + 1] ?? "0", 10);
    let current: Buffer;
    try {
      current = Buffer.from(await fs.readFileBuffer(abs(last)));
    } catch {
      current = Buffer.alloc(0);
    }
    const next = Buffer.alloc(len);
    current.copy(next, 0, 0, Math.min(current.length, len));
    await fs.writeFile(abs(last), next);
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  if (command === "mktemp") {
    const dir = last.replace(/X{3,}$/, randomUUID().replace(/-/g, "").slice(0, 6));
    await fs.mkdir(abs(dir), { recursive: true });
    return { stdout: `${dir}\n`, stderr: "", exitCode: 0 };
  }

  if (command === "realpath") {
    try {
      return { stdout: `${await fs.realpath(abs(last))}\n`, stderr: "", exitCode: 0 };
    } catch {
      return enoent("realpath", last);
    }
  }

  if (command === "test") {
    // Only `-e` (exists) is used by the SDK's FileSystem.
    return { stdout: "", stderr: "", exitCode: (await fs.exists(abs(last))) ? 0 : 1 };
  }

  return null;
}
