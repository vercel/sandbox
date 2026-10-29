import * as cmd from "cmd-ts";
import { GITHUB_API_CREDENTIAL_ACTIONS } from "@vercel/sandbox";
import type { ArgParser } from "cmd-ts/dist/esm/argparser";
import type { ProvidesHelp } from "cmd-ts/dist/esm/helpdoc";
import { createScope, scope } from "./scope";
import { createTokenOption } from "./auth";
import { CliError } from "../util/cli-error";
import {
  hasCreationOptions,
  MANAGED_CREDENTIALS_GATE,
  resolveCreationInput,
  type CreationInput,
} from "../util/creation-input";
import {
  resolveExecutionMode,
  type ExecutionMode,
} from "../util/execution-mode";

const optionalString = (
  long: string,
  displayName: string,
  description: string,
) =>
  cmd.option({
    long,
    description,
    type: { ...cmd.optional(cmd.string), displayName },
  });

const credentialOptions = {
  commitAsEmail: optionalString(
    "commit-as-email",
    "VALUE",
    "Commit email for the managed Git source. Requires --commit-as-name. (experimental)",
  ),
  commitAsMe: cmd.flag({
    long: "commit-as-me",
    type: cmd.optional(cmd.boolean),
    description:
      "Use Git's global user.name and user.email for the managed Git source. Cannot be combined with --commit-as-name or --commit-as-email. (experimental)",
  }),
  commitAsName: optionalString(
    "commit-as-name",
    "NAME",
    "Commit name for the managed Git source. Requires --commit-as-email. (experimental)",
  ),
  noCommitAsMe: cmd.flag({
    long: "no-commit-as-me",
    type: cmd.optional(cmd.boolean),
    description: "Do not use Git's global commit identity. (experimental)",
  }),
  file: optionalString(
    "file",
    "FILE",
    "Read source, commitAs, and credentials from a JSON file. - reads stdin. Cannot be combined with credential options. (experimental)",
  ),
  gitSource: optionalString(
    "git-source",
    "URL",
    "Clone an HTTPS Git repository. Add a commit identity to use managed GitHub credentials. (experimental)",
  ),
  github: cmd.flag({
    long: "github",
    type: cmd.optional(cmd.boolean),
    description:
      "Enable GitHub API forwarding without initial grants. Does not make the source clone managed. (experimental)",
  }),
  noGithub: cmd.flag({
    long: "no-github",
    type: cmd.optional(cmd.boolean),
    description:
      "Omit GitHub API forwarding. Conflicts with GitHub credential options. (experimental)",
  }),
  githubActAs: optionalString(
    "github-act-as",
    "USER",
    "Numeric GitHub user ID for the credential group; otherwise use the direct caller's connected account. (experimental)",
  ),
  githubActions: cmd.multioption({
    long: "github-action",
    type: cmd.array({
      ...cmd.oneOf(GITHUB_API_CREDENTIAL_ACTIONS),
      displayName: "VALUE",
    }),
    description: `GitHub API action. Repeat to append; duplicates and comma-separated lists are rejected. All listed repositories receive every action. Accepted: ${GITHUB_API_CREDENTIAL_ACTIONS.join(", ")}. (experimental)`,
  }),
  githubRepositories: cmd.multioption({
    long: "github-repository",
    type: cmd.array({ ...cmd.string, displayName: "REPOSITORY" }),
    description:
      "GitHub owner/repository. Repeat to append; duplicates are rejected. One shared identity and action set; use --file for multiple groups. (experimental)",
  }),
};

type Parsed<T> = T extends ArgParser<infer Value> ? Value : never;
export type CreateContext = Parsed<typeof scope> & {
  appName?: "sandbox" | "vercel sandbox";
  creation: CreationInput;
  creationRequested: boolean;
  mode: ExecutionMode;
  yes: boolean;
};

export function createContext({
  allowJson = true,
} = {}): ArgParser<CreateContext> & ProvidesHelp {
  const executionOptions = {
    yes: cmd.flag({
      long: "yes",
      short: "y",
      description:
        "Confirm granting managed access to the sandbox. Does not supply missing inputs.",
    }),
    nonInteractive: cmd.flag({
      long: "non-interactive",
      type: cmd.optional(cmd.boolean),
      description: "Never prompt; fail if input or consent is missing.",
    }),
    ...(allowJson
      ? {
          json: cmd.flag({
            long: "json",
            description:
              "Output the created sandbox as JSON. Disables prompts but does not grant consent.",
          }),
        }
      : {}),
  };
  return {
    register(context) {
      for (const option of Object.values({
        ...credentialOptions,
        ...executionOptions,
      }))
        option.register?.(context);
      scope.register?.(context);
    },
    helpTopics() {
      const credentials =
        process.env[MANAGED_CREDENTIALS_GATE] === "1"
          ? Object.values(credentialOptions)
          : [];
      return [
        ...[...credentials, ...Object.values(executionOptions)]
          .flatMap((option) => option.helpTopics())
          .map((topic) => ({ ...topic, category: "options" })),
        ...scope.helpTopics(),
      ];
    },
    async parse(context) {
      // Parse and validate local inputs before auth or scope inference. In
      // particular, a malformed file must never start login or create work.
      const execution = await parseOptions(executionOptions, context);
      const json = execution.json === true;
      try {
        const options = await parseOptions(credentialOptions, context);
        const creation = await resolveCreationInput(options);
        const mode = await resolveExecutionMode({
          json,
          nonInteractive: execution.nonInteractive,
          payloadStdin: options.file === "-",
        });
        const creationRequested = hasCreationOptions(options);
        const auth = createScope(
          createTokenOption(!creationRequested && mode.interactive),
        );
        const result = await auth.parse(context);
        if (result._tag === "error") {
          if (json || creationRequested) {
            throw new CliError(
              "Can't resolve authentication, team, or project. Set VERCEL_TOKEN and pass --scope and --project, or run sandbox login first.",
              {
                reason: "missing_context",
                data: { required: ["VERCEL_TOKEN", "--scope", "--project"] },
              },
            );
          }
          return result;
        }
        return {
          _tag: "ok",
          value: {
            ...result.value,
            appName: context.hotPath?.includes("vercel sandbox")
              ? "vercel sandbox"
              : "sandbox",
            creation,
            creationRequested,
            mode,
            yes: execution.yes,
          },
        };
      } catch (error) {
        if (error instanceof CliError) {
          throw new CliError(error.message, { ...error.options, json });
        }
        throw error;
      }
    },
  };
}

async function parseOptions<T extends Record<string, ArgParser<unknown>>>(
  options: T,
  context: Parameters<ArgParser<unknown>["parse"]>[0],
): Promise<{ [Key in keyof T]: Parsed<T[Key]> }> {
  const values: Record<string, unknown> = {};
  for (const [key, option] of Object.entries(options)) {
    const result = await option.parse(context);
    if (result._tag === "error") {
      const syntax = (
        option as ArgParser<unknown> & ProvidesHelp
      ).helpTopics()[0]?.usage;
      throw new CliError(
        `Invalid or repeated option: ${syntax ?? key}. Check the option's value and repeat behavior.`,
      );
    }
    values[key] = result.value;
  }
  return values as { [Key in keyof T]: Parsed<T[Key]> };
}
