import { token } from "./auth";
import * as cmd from "cmd-ts";
import type { ArgParser } from "cmd-ts/dist/esm/argparser";
import { inferScope } from "../util/infer-scope";
import type { ProvidesHelp } from "cmd-ts/dist/esm/helpdoc";
import chalk from "chalk";

const project = cmd.option({
  long: "project",
  type: { ...cmd.optional(cmd.string), displayName: "my-project" },
  description:
    "The project name or ID to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN.",
});

/** Parser for the `--team` option. */
const teamParser = cmd.option({
  long: "team",
  type: { ...cmd.optional(cmd.string), displayName: "my-team" },
});
/** Parser for the `--scope` option. */
const scopeParser = cmd.option({
  long: "scope",
  type: { ...cmd.optional(cmd.string), displayName: "my-team" },
  description:
    "The scope/team to associate with the command. Can be inferred from VERCEL_OIDC_TOKEN. [alias: --team]",
});

/** Parser for the `--scope` option that falls back to `--team` if not provided. */
const team: typeof scopeParser = {
  ...scopeParser,
  register(opts) {
    scopeParser.register?.(opts);
    teamParser.register?.(opts);
  },
  async parse(context) {
    const [scope, team] = await Promise.all([
      scopeParser.parse(context),
      teamParser.parse(context),
    ]);

    if (scope._tag !== "error" && typeof scope.value === "undefined") {
      if (team._tag !== "error" && team.value) {
        return team;
      } else if (team._tag === "error") {
        return team;
      }
    }

    return scope;
  },
};

/**
 * Combining multiple argument parsing into a single "scope" argument
 * that includes token, project, and team.
 * If project or team are not provided, they will be inferred.
 */
export const scope: ArgParser<{
  token: string;
  project: string;
  team: string;
  projectSlug?: string;
  teamSlug?: string;
}> &
  ProvidesHelp = {
  register(ctx) {
    token.register?.(ctx);
    project.register?.(ctx);
    team.register?.(ctx);
  },
  async parse(context) {
    const t = await token.parse(context);
    if (t._tag === "error") {
      return t;
    }

    // We want to find all the arguments that `--project` or `--team` are
    // visiting, so the errors will be nicer.
    const visited = new Set(context.visitedNodes);
    let [projectId, teamId] = await Promise.all([
      project.parse(context),
      team.parse(context),
    ]);
    const nodes = Array.from(context.visitedNodes).filter(
      (x) => !visited.has(x),
    );

    if (projectId._tag === "error") {
      return projectId;
    }

    if (teamId._tag === "error") {
      return teamId;
    }

    let projectSlug: string | undefined;
    let teamSlug: string | undefined;

    if (
      typeof projectId.value === "undefined" ||
      typeof teamId.value === "undefined"
    ) {
      try {
        const scope = await inferScope({
          token: t.value,
          team: teamId.value,
        });
        projectId.value ??= scope.projectId;
        teamId.value ??= scope.ownerId;
        projectSlug = scope.projectSlug;
        teamSlug = scope.ownerSlug;
      } catch (err) {
        return {
          _tag: "error",
          error: {
            errors: [
              {
                nodes,
                message: [
                  `Could not determine team/project scope: ${(err as Error).message}.`,
                  `${chalk.bold("hint:")} Specify explicitly with --scope TEAM_SLUG --project PROJECT_NAME, or set VERCEL_OIDC_TOKEN.`,
                  "╰▶ Docs: https://vercel.com/docs/sandbox",
                ].join("\n"),
              },
            ],
          },
        };
      }
    }

    return {
      _tag: "ok",
      value: {
        token: t.value,
        project: projectId.value,
        team: teamId.value,
        projectSlug,
        teamSlug,
      },
    };
  },
  helpTopics() {
    return [
      ...token.helpTopics(),
      ...project.helpTopics(),
      ...team.helpTopics(),
    ].map((x) => ({
      ...x,
      category: "Auth & Scope",
    }));
  },
};
