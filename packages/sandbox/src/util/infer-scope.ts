import { z } from "zod/v4";
import { readProjectConfiguration } from "./project-configuration";
import createDebugger from "debug";
import * as Auth from "@vercel/sandbox/dist/auth/index.js";

const debug = createDebugger("sandbox:scope");

/**
 * Inferred scope information for a sandbox session.
 */
export type InferredScope = {
  /** Project identifier — may be an ID (prj_*) or a slug */
  project: string;
  /** Team/owner identifier — may be an ID (team_*) or a slug */
  owner: string;
  /** Human-readable project slug for display */
  projectSlug?: string;
  /** Human-readable team slug for display */
  ownerSlug?: string;
};

export async function inferScope({
  token,
  team,
  environment,
}: {
  token: string;
  team?: string;
  environment?: { team?: string; project?: string };
}): Promise<InferredScope> {
  // If the token is a JWT (OIDC token), extract scope from its claims
  const jwt = z.jwt().safeParse(token);
  if (jwt.success) {
    debug("trying to infer scope from OIDC JWT");
    const data = await inferFromJwt(jwt.data);
    debug("Using scope from OIDC JWT", data);
    return data;
  }

  const requestedTeam = team ?? environment?.team;
  if (requestedTeam && environment?.project) {
    debug("Using scope from environment variables", {
      owner: requestedTeam,
      project: environment.project,
    });
    return { owner: requestedTeam, project: environment.project };
  }

  const projectJson = readProjectConfiguration(process.cwd());
  if (projectJson) {
    debug("Using scope from project configuration", {
      owner: projectJson.orgId,
      project: projectJson.projectId,
    });
    return { owner: projectJson.orgId, project: projectJson.projectId };
  }

  debug("trying to infer scope from API token", { team: requestedTeam });
  const fromToken = await inferFromToken(token, requestedTeam);
  debug("Using scope from API token", fromToken);
  return fromToken;
}

const JwtSchema = z
  .object({
    project_id: z.string(),
    owner_id: z.string(),
    project: z.string().optional(),
    owner: z.string().optional(),
  })
  .transform((data) => {
    return {
      project: data.project_id,
      owner: data.owner_id,
      projectSlug: data.project,
      ownerSlug: data.owner,
    };
  });

async function inferFromJwt(jwt: string) {
  const body = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString());
  return { _tag: "OIDC" as const, ...JwtSchema.parse(body) };
}

async function inferFromToken(token: string, requestedTeam?: string) {
  const { teamId, teamSlug, projectId, projectSlug } = await Auth.inferScope({
    token,
    teamId: requestedTeam,
  });
  return {
    owner: teamId,
    project: projectId,
    ownerSlug: teamSlug ?? teamId,
    projectSlug: projectSlug ?? projectId,
  };
}
