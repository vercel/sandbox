import * as cmd from "cmd-ts";
import type { ArgParser } from "cmd-ts/dist/esm/argparser";
import type { ProvidesHelp } from "cmd-ts/dist/esm/helpdoc";
import { createScope, scope } from "./scope";
import { createTokenOption } from "./auth";
import {
  executionOptions,
  managedCredentialOptions,
} from "./managed-credentials";
import { CliError } from "../util/cli-error";
import {
  resolveExecutionMode,
  type ExecutionMode,
} from "../util/execution-mode";
import {
  hasManagedCredentialsRequest,
  resolveManagedCredentials,
  type ManagedCredentialsOptions,
  type ResolvedManagedCredentials,
} from "../util/managed-credentials-resolve";
import {
  toTransport,
  type ManagedCredentialsTransport,
} from "../util/managed-credentials-transport";
import { loadConfigFromSandbox } from "../util/managed-credentials-reuse";
import { fetchSandboxCredentialSnapshot } from "../util/managed-credentials-client";

type Parsed<T> = T extends ArgParser<infer Value> ? Value : never;
export type CreateContext = Parsed<typeof scope> & {
  appName?: "sandbox" | "vercel sandbox";
  creation: ManagedCredentialsTransport;
  creationRequested: boolean;
  mode: ExecutionMode;
  yes: boolean;
  dryRun: boolean;
  managed?: ResolvedManagedCredentials;
  managedOptions?: ManagedCredentialsOptions;
  persistConfiguration?: string;
};

/** Resolve the proposal without granting access or performing creation. */
export function createContext({
  allowJson = true,
} = {}): ArgParser<CreateContext> & ProvidesHelp {
  const execution = {
    yes: cmd.flag({
      long: "yes",
      short: "y",
      description:
        "Confirm granting managed access. Does not supply missing inputs.",
    }),
    nonInteractive: cmd.flag({
      long: "non-interactive",
      type: cmd.optional(cmd.boolean),
      description: "Never prompt; fail if input or consent is missing.",
    }),
    ...executionOptions,
    ...(allowJson
      ? {
          json: cmd.flag({
            long: "json",
            description:
              "Output JSON. Disables prompts but does not grant consent.",
          }),
        }
      : {}),
  };
  const options = { ...managedCredentialOptions, ...execution };
  return {
    register(context) {
      for (const option of Object.values(options)) option.register?.(context);
      scope.register?.(context);
    },
    helpTopics() {
      return [
        ...Object.values(options)
          .flatMap((option) => option.helpTopics())
          .map((topic) => ({
            ...topic,
            category: topic.category ?? "options",
          })),
        ...scope.helpTopics(),
      ];
    },
    async parse(context) {
      const run = await parseOptions(execution, context);
      const json = run.json === true;
      try {
        const managedOptions = await parseOptions(
          managedCredentialOptions,
          context,
        );
        const creationRequested = hasManagedCredentialsRequest(managedOptions);
        const dryRun = run.dryRun === true;
        const mode = await resolveExecutionMode({
          json,
          nonInteractive: run.nonInteractive,
          payloadStdin: managedOptions.credentialsFromConfigFile === "-",
        });
        // Read and validate files before authentication, including piped input.
        const imported =
          managedOptions.credentialsFromConfigFile !== undefined
            ? await resolveManagedCredentials(managedOptions, { token: "" })
            : undefined;
        const auth = createScope(
          createTokenOption(
            !creationRequested && mode.interactive && !dryRun,
            dryRun,
          ),
          dryRun,
        );
        const result = await auth.parse(context);
        if (result._tag === "error") {
          if (json || creationRequested || dryRun)
            throw new CliError(
              "Can't resolve authentication, team, or project. Pass --token, --scope and --project, or use existing local project/OIDC context. Dry-run never refreshes credentials or creates a project.",
              {
                reason: "missing_context",
                data: { required: ["--token", "--scope", "--project"] },
              },
            );
          return result;
        }
        const managed =
          imported ??
          (await resolveManagedCredentials(managedOptions, {
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
                    dryRun,
                  }),
              }),
          }));
        return {
          _tag: "ok",
          value: {
            ...result.value,
            appName: context.hotPath?.includes("vercel sandbox")
              ? "vercel sandbox"
              : "sandbox",
            creation: managed ? toTransport(managed.config) : {},
            creationRequested,
            mode,
            yes: run.yes,
            dryRun,
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
        if (error instanceof CliError)
          throw new CliError(error.message, { ...error.options, json });
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
      const specific = (
        result as { error?: { errors?: { message?: string }[] } }
      ).error?.errors?.find((entry) => entry.message?.includes("--"))?.message;
      throw new CliError(
        specific ??
          `Invalid or repeated option: ${syntax ?? key}. Check the option's value and repeat behavior.`,
      );
    }
    values[key] = result.value;
  }
  return values as { [Key in keyof T]: Parsed<T[Key]> };
}

export type { ManagedCredentialsOptions };
