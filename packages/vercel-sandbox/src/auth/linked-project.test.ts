import { readLinkedProject } from "./linked-project";
import { describe, test, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "linked-project-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
}

describe("readLinkedProject", () => {
  test("returns null when .vercel/project.json does not exist", async () => {
    await withTempDir(async (dir) => {
      const result = await readLinkedProject(dir);
      expect(result).toBeNull();
    });
  });

  test("returns null when .vercel directory exists but project.json does not", async () => {
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, ".vercel"));
      const result = await readLinkedProject(dir);
      expect(result).toBeNull();
    });
  });

  test("returns projectId and teamId when project.json exists", async () => {
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, ".vercel"));
      await fs.writeFile(
        path.join(dir, ".vercel", "project.json"),
        JSON.stringify({
          projectId: "prj_123",
          orgId: "team_456",
          settings: { framework: null },
        }),
      );
      const result = await readLinkedProject(dir);
      expect(result).toEqual({
        projectId: "prj_123",
        teamId: "team_456",
      });
    });
  });

  test("returns null when project.json is invalid JSON", async () => {
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, ".vercel"));
      await fs.writeFile(
        path.join(dir, ".vercel", "project.json"),
        "not valid json",
      );
      const result = await readLinkedProject(dir);
      expect(result).toBeNull();
    });
  });

  test("returns null when project.json is missing projectId", async () => {
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, ".vercel"));
      await fs.writeFile(
        path.join(dir, ".vercel", "project.json"),
        JSON.stringify({ orgId: "team_456" }),
      );
      const result = await readLinkedProject(dir);
      expect(result).toBeNull();
    });
  });

  test("returns null when project.json is missing orgId", async () => {
    await withTempDir(async (dir) => {
      await fs.mkdir(path.join(dir, ".vercel"));
      await fs.writeFile(
        path.join(dir, ".vercel", "project.json"),
        JSON.stringify({ projectId: "prj_123" }),
      );
      const result = await readLinkedProject(dir);
      expect(result).toBeNull();
    });
  });
});
