import { z } from "zod/v4";
import { readProjectConfiguration } from "./project-configuration";
import createDebugger from "debug";
import * as Auth from "@vercel/sandbox/dist/auth/index.js";
import { readVercelCurrentTeam } from "./current-team";

const debug = createDebugger("sandbox:scope");

export interface ScopeProvenance {
  team: string;
  project: string;
}

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
  /** Display metadata, never authorization. */
  source?: "oidc" | "project-config" | "vercel-cli" | "account-default";
};

export async function inferScope({
  token,
  team,
  readOnly,
}: {
  token: string;
  team?: string;
  readOnly?: boolean;
}): Promise<InferredScope> {
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
      owner: projectJson.orgId,
      project: projectJson.projectId,
    });
    return {
      owner: projectJson.orgId,
      project: projectJson.projectId,
      source: "project-config",
    };
  }

  const selectedTeam = team === undefined ? readVercelCurrentTeam() : undefined;
  debug("trying to infer scope from API token", {
    team: team ?? selectedTeam,
    readOnly,
  });
  const fromToken = await inferFromToken(token, team ?? selectedTeam, readOnly);
  debug("Using scope from API token", fromToken);
  return selectedTeam ? { ...fromToken, source: "vercel-cli" } : fromToken;
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
  return {
    _tag: "OIDC" as const,
    source: "oidc" as const,
    ...JwtSchema.parse(body),
  };
}

async function inferFromToken(
  token: string,
  requestedTeam?: string,
  readOnly = false,
) {
  const { teamId, teamSlug, projectId, projectSlug } = await Auth.inferScope({
    token,
    teamId: requestedTeam,
    ...(readOnly ? { readOnly: true } : {}),
  });
  return {
    source: "account-default" as const,
    owner: teamId,
    project: projectId,
    ownerSlug: teamSlug ?? teamId,
    projectSlug: projectSlug ?? projectId,
  };
}
