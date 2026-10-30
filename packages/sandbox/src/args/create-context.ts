import * as cmd from "cmd-ts";
import { GITHUB_API_CREDENTIAL_ACTIONS } from "@vercel/sandbox";
import type { ArgParser } from "cmd-ts/dist/esm/argparser";
import type { ProvidesHelp } from "cmd-ts/dist/esm/helpdoc";
import { createScope, scope } from "./scope";
import { createTokenOption } from "./auth";
import { CliError } from "../util/cli-error";
import {
  hasCreationOptions,
  resolveCreationInput,
  type CreationInput,
} from "../util/creation-input";
import {
  resolveExecutionMode,
  type ExecutionMode,
} from "../util/execution-mode";
import {
  executionOptions as runOptions,
  managedCredentialOptions,
} from "./managed-credentials";
import {
  hasManagedCredentialsRequest,
  resolveManagedCredentials,
  type ManagedCredentialsOptions,
  type ResolvedManagedCredentials,
} from "../util/managed-credentials-resolve";
import { toTransport } from "../util/managed-credentials-transport";
import { loadConfigFromSandbox } from "../util/managed-credentials-reuse";
import { fetchSandboxCredentialSnapshot } from "../util/managed-credentials-client";

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

/**
 * The original flag surface, kept working.
 *
 * These predate the `--credentials-*` options and describe the same request in
 * transport terms. They are accepted unchanged so existing scripts keep
 * running, and the help text points at the replacement. They cannot be mixed
 * with the `--credentials-*` options: the two describe access differently, and
 * combining them would mean merging permission sets implicitly.
 */
const legacyCredentialOptions = {
  commitAsEmail: optionalString(
    "commit-as-email",
    "VALUE",
    "Deprecated: use --credentials-commit-as. Commit email for the managed Git source. (experimental)",
  ),
  commitAsMe: cmd.flag({
    long: "commit-as-me",
    type: cmd.optional(cmd.boolean),
    description:
      "Deprecated: use --credentials-commit-as. Use Git's global commit identity for the managed Git source. (experimental)",
  }),
  commitAsName: optionalString(
    "commit-as-name",
    "NAME",
    "Deprecated: use --credentials-commit-as. Commit name for the managed Git source. (experimental)",
  ),
  noCommitAsMe: cmd.flag({
    long: "no-commit-as-me",
    type: cmd.optional(cmd.boolean),
    description:
      "Deprecated. Do not use Git's global commit identity. (experimental)",
  }),
  managedCredentialsFile: optionalString(
    "managed-credentials-file",
    "FILE",
    "Deprecated: use --credentials-from-config-file. Read source, commitAs, and credentials from a JSON file. (experimental)",
  ),
  gitSource: optionalString(
    "git-source",
    "URL",
    "Deprecated: use --credentials-repo. Clone an HTTPS Git repository. (experimental)",
  ),
  github: cmd.flag({
    long: "github",
    type: cmd.optional(cmd.boolean),
    description:
      "Deprecated: use --enable-managed-credentials. Enable GitHub API forwarding without initial grants. (experimental)",
  }),
  noGithub: cmd.flag({
    long: "no-github",
    type: cmd.optional(cmd.boolean),
    description:
      "Deprecated. Omit GitHub API forwarding. Conflicts with GitHub credential options. (experimental)",
  }),
  githubActAs: optionalString(
    "github-act-as",
    "USER",
    "Deprecated: use --credentials-act-as. GitHub user ID or username for the credential group. (experimental)",
  ),
  githubActions: cmd.multioption({
    long: "github-action",
    type: cmd.array({
      ...cmd.oneOf(GITHUB_API_CREDENTIAL_ACTIONS),
      displayName: "VALUE",
    }),
    description: `Deprecated: use --credentials-action. GitHub API action; repeat to append. Accepted: ${GITHUB_API_CREDENTIAL_ACTIONS.join(", ")}. (experimental)`,
  }),
  githubRepositories: cmd.multioption({
    long: "github-repository",
    type: cmd.array({ ...cmd.string, displayName: "REPOSITORY" }),
    description:
      "Deprecated: use --credentials-repo. GitHub owner/repository; repeat to append. (experimental)",
  }),
};

type Parsed<T> = T extends ArgParser<infer Value> ? Value : never;

export type CreateContext = Parsed<typeof scope> & {
  appName?: "sandbox" | "vercel sandbox";
  /** The request in transport terms, ready for `Sandbox.create`. */
  creation: CreationInput;
  creationRequested: boolean;
  mode: ExecutionMode;
  yes: boolean;
  dryRun: boolean;
  /** The logical managed-credentials proposal, when one was requested. */
  managed?: ResolvedManagedCredentials;
  /** The raw options, so a review correction can re-run inference. */
  managedOptions?: ManagedCredentialsOptions;
  /** `--credentials-persist-configuration`: `undefined`, `""`, or a path. */
  persistConfiguration?: string;
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
    ...runOptions,
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

  const allOptions = {
    ...legacyCredentialOptions,
    ...managedCredentialOptions,
    ...executionOptions,
  };

  return {
    register(context) {
      for (const option of Object.values(allOptions))
        option.register?.(context);
      scope.register?.(context);
    },
    helpTopics() {
      return [
        ...Object.values(allOptions)
          .flatMap((option) => option.helpTopics())
          .map((topic) => ({
            ...topic,
            category: topic.category ?? "options",
          })),
        ...scope.helpTopics(),
      ];
    },
    async parse(context) {
      // Parse and validate local inputs before auth or scope inference. In
      // particular, a malformed file must never start login or create work.
      const execution = await parseOptions(executionOptions, context);
      const json = execution.json === true;
      try {
        const legacy = await parseOptions(legacyCredentialOptions, context);
        const managedOptions = await parseOptions(
          managedCredentialOptions,
          context,
        );

        const legacyRequested = hasCreationOptions(legacy);
        const managedRequested = hasManagedCredentialsRequest(managedOptions);
        if (legacyRequested && managedRequested) {
          throw new CliError(
            "The --credentials-* options replace the older --git-source/--github-* options and cannot be combined with them. Use the --credentials-* options alone.",
          );
        }

        const creationRequested = legacyRequested || managedRequested;
        const mode = await resolveExecutionMode({
          json,
          nonInteractive: execution.nonInteractive,
          payloadStdin:
            legacy.managedCredentialsFile === "-" ||
            managedOptions.credentialsFromConfigFile === "-",
        });

        // The legacy path does not need auth to validate its input, so keep
        // resolving it before login as it did.
        const legacyCreation = legacyRequested
          ? await resolveCreationInput(legacy)
          : {};

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

        // Called even when nothing was requested, so option-compatibility rules
        // still apply — `--credentials-persist-configuration` on its own would
        // otherwise exit successfully having saved nothing. It returns
        // `undefined` for a bare create.
        //
        // Inference needs the resolved scope: the actor fallback is a Vercel
        // API lookup, and the proposal shows the team and project it will
        // create in.
        const managed = await resolveManagedCredentials(managedOptions, {
          token: result.value.token,
          teamId: result.value.team,
          loadFromSandbox: (selector) =>
            loadConfigFromSandbox({
              selector,
              fetchSnapshot: (params) =>
                fetchSandboxCredentialSnapshot({
                  ...params,
                  token: result.value.token,
                  teamId: result.value.team,
                  projectId: result.value.project,
                }),
            }),
        });

        const creation = managed
          ? (toTransport(managed.config) as CreationInput)
          : legacyCreation;

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
            dryRun: execution.dryRun === true,
            ...(managed ? { managed, managedOptions } : {}),
            ...(managedOptions.credentialsPersistConfiguration !== undefined
              ? {
                  persistConfiguration:
                    managedOptions.credentialsPersistConfiguration,
                }
              : {}),
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
      // Prefer a parser's own message when it explains the specific mistake
      // and names the option itself. cmd-ts's generic messages ("Too many
      // times provided") omit the option name, so those keep the fallback,
      // which spells out the offending option's syntax.
      const specific = (
        result as { error?: { errors?: { message?: string }[] } }
      ).error?.errors?.find((entry) => entry?.message?.includes("--"))?.message;
      if (specific) throw new CliError(specific);
      throw new CliError(
        `Invalid or repeated option: ${syntax ?? key}. Check the option's value and repeat behavior.`,
      );
    }
    values[key] = result.value;
  }
  return values as { [Key in keyof T]: Parsed<T[Key]> };
}

export type { ManagedCredentialsOptions };
