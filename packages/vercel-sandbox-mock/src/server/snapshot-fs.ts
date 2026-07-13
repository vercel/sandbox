import type { IFileSystem } from "just-bash";
import type { SnapshotFileEntry } from "./registry.js";

/**
 * Capture every path in an in-memory filesystem (files, directories, symlinks)
 * with modes preserved. Used to snapshot a session and to persist a sandbox's
 * disk across stop/resume.
 */
export async function captureFileSystem(source: IFileSystem): Promise<SnapshotFileEntry[]> {
  const entries: SnapshotFileEntry[] = [];
  for (const path of source.getAllPaths().filter((p) => p !== "/")) {
    const stats = await source.lstat(path);
    if (stats.isDirectory) {
      entries.push({ path, mode: stats.mode, type: "directory" });
    } else if (stats.isSymbolicLink) {
      entries.push({ path, type: "symlink", target: await source.readlink(path) });
    } else {
      entries.push({
        path,
        mode: stats.mode,
        type: "file",
        content: Buffer.from(await source.readFileBuffer(path)),
      });
    }
  }
  return entries;
}

/** Restore a captured filesystem into a target, recreating dirs before leaves. */
export async function restoreFileSystem(
  entries: SnapshotFileEntry[],
  target: IFileSystem,
): Promise<void> {
  const targetPaths = new Set(target.getAllPaths());
  const ordered = [...entries].sort(
    (a, b) => a.path.split("/").length - b.path.split("/").length,
  );

  for (const entry of ordered) {
    if (entry.type === "directory" && !targetPaths.has(entry.path)) {
      await target.mkdir(entry.path, { recursive: true });
    }
  }
  for (const entry of ordered) {
    if (entry.type === "directory") continue;
    if (entry.type === "symlink") {
      if (targetPaths.has(entry.path)) await target.rm(entry.path, { force: true });
      await target.symlink(entry.target, entry.path);
    } else {
      await target.writeFile(entry.path, entry.content);
    }
  }
  for (const entry of ordered) {
    if (entry.type !== "symlink") await target.chmod(entry.path, entry.mode);
  }
}
