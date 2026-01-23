import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { json } from "./zod";

const LinkedProjectSchema = json.pipe(
  z.object({
    projectId: z.string(),
    orgId: z.string(),
  }),
);

/**
 * Reads the linked project configuration from `.vercel/project.json`.
 *
 * @param cwd - The directory to search for `.vercel/project.json`.
 * @returns The linked project's `projectId` and `teamId`, or `null` if not found.
 */
export async function readLinkedProject(
  cwd: string,
): Promise<{ projectId: string; teamId: string } | null> {
  const projectJsonPath = path.join(cwd, ".vercel", "project.json");

  let content: string;
  try {
    content = await fs.readFile(projectJsonPath, "utf-8");
  } catch {
    return null;
  }

  const parsed = LinkedProjectSchema.safeParse(content);
  if (!parsed.success) {
    return null;
  }

  return {
    projectId: parsed.data.projectId,
    teamId: parsed.data.orgId,
  };
}
