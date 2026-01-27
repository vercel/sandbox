import { z } from "zod/v4";
import { readProjectConfiguration } from "./project-configuration";
import createDebugger from "debug";
import * as Auth from "@vercel/sandbox/dist/auth/index.js";

const debug = createDebugger("sandbox:scope");

export async function inferScope({
  token,
  team,
}: {
  token: string;
  team?: string;
}): Promise<{ projectId: string; ownerId: string }> {
  // If the token is a JWT (OIDC token), extract scope from its claims
  const jwt = z.jwt().safeParse(token);
  if (jwt.success) {
    debug("trying to infer scope from OIDC JWT");
    const data = await inferFromJwt(jwt.data);
    debug("Using scope from OIDC JWT", data);
    return data;
  }

  const projectJson = readProjectConfiguration(process.cwd());
  if (projectJson) {
    debug("Using scope from project configuration", {
      ownerId: projectJson.orgId,
      projectId: projectJson.projectId,
    });
    return { ownerId: projectJson.orgId, projectId: projectJson.projectId };
  }

  debug("trying to infer scope from API token", { token, team });
  const fromToken = await inferFromToken(token, team);
  debug("Using scope from API token", fromToken);
  return fromToken;
}

const JwtSchema = z
  .object({
    project_id: z.string(),
    owner_id: z.string(),
  })
  .transform((data) => {
    return { projectId: data.project_id, ownerId: data.owner_id };
  });

async function inferFromJwt(jwt: string) {
  const body = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString());
  return { _tag: "OIDC" as const, ...JwtSchema.parse(body) };
}

async function inferFromToken(token: string, requestedTeam?: string) {
  const { teamId, projectId } = await Auth.inferScope({
    token,
    teamId: requestedTeam,
  });
  return { ownerId: teamId, projectId };
}
