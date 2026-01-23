import fs from "node:fs";
import path from "node:path";
import { z } from "zod/v4";
import { jsonCodec } from "./zod";

const ProjectConfiguration = jsonCodec(
  z.object({
    orgId: z.string(),
    projectId: z.string(),
  }),
);

export function readProjectConfiguration(cwd: string) {
  try {
    const pathname = path.join(cwd, ".vercel", "project.json");
    const string = fs.readFileSync(pathname, "utf8");
    return ProjectConfiguration.decode(string);
  } catch {
    return null;
  }
}
