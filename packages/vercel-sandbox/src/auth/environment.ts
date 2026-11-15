/**
 * Reads the team ID from `VERCEL_TEAM_ID` or `VERCEL_ORG_ID`, the name the
 * Vercel CLI's CI guidance uses. Throws when both are set to different values.
 */
export function getTeamIdFromEnvironment(): string | undefined {
  const teamId = process.env.VERCEL_TEAM_ID;
  const orgId = process.env.VERCEL_ORG_ID;
  if (teamId && orgId && teamId !== orgId) {
    throw new Error(
      `VERCEL_TEAM_ID (${teamId}) and VERCEL_ORG_ID (${orgId}) name different teams. Unset one of them.`,
    );
  }
  return teamId || orgId || undefined;
}
