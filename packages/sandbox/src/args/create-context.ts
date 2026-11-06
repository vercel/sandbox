import * as cmd from "cmd-ts";
import type { ArgParser } from "cmd-ts/dist/esm/argparser";
import type { ProvidesHelp } from "cmd-ts/dist/esm/helpdoc";
import { createScope, scope } from "./scope";
import type { ScopeProvenance } from "../util/infer-scope";
import { createTokenOption } from "./auth";
import { managedCredentialOptions } from "./managed-credentials";
import { CliError } from "../util/cli-error";
import { isInteractive } from "../util/execution-mode";
import {
  assertCompatibleOptions,
  hasManagedCredentialsRequest,
  resolveManagedCredentials,
  type ManagedCredentialsOptions,
  type ResolvedManagedCredentials,
} from "../util/managed-credentials-resolve";
import { loadConfigFromSandbox } from "../util/managed-credentials-reuse";
import { fetchSandboxCredentialSnapshot } from "../util/managed-credentials-client";

type Parsed<T> = T extends ArgParser<infer Value> ? Value : never;
export type CreateContext = Parsed<typeof scope> & {
  appName?: "sandbox" | "vercel sandbox";
  creationRequested: boolean;
  interactive: boolean;
  scopeProvenance?: ScopeProvenance;
  yes: boolean;
  managed?: ResolvedManagedCredentials;
  managedOptions?: ManagedCredentialsOptions;
  persistConfiguration?: string;
  /** Replaying an explicit token must not silently select another login. */
  hasExplicitToken?: boolean;
};

/** Resolve the proposal without granting access or performing creation. */
export function createContext(): ArgParser<CreateContext> & ProvidesHelp {
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
      const managedOptions = await parseOptions(
        managedCredentialOptions,
        context,
      );
      // Reject incompatible flags before reading payloads or resolving auth.
      assertCompatibleOptions(managedOptions);
      const creationRequested = hasManagedCredentialsRequest(managedOptions);
      const interactive = await isInteractive({
        nonInteractive: run.nonInteractive,
        payloadStdin: managedOptions.credentialsFromConfigFile === "-",
      });
      // Read and validate files before authentication, including piped input.
      const imported =
        managedOptions.credentialsFromConfigFile !== undefined
          ? await resolveManagedCredentials(managedOptions, { token: "" })
          : undefined;
      let scopeProvenance: ScopeProvenance | undefined;
      const auth = createScope(
        createTokenOption(!creationRequested && interactive),
        (provenance) => {
          scopeProvenance = provenance;
        },
      );
      const result = await auth.parse(context);
      if (result._tag === "error") {
        if (creationRequested)
          throw new CliError(
            "Can't resolve authentication, team, or project. Use a saved login, local project/OIDC context, or explicit --token, --scope and --project.",
            {
              reason: "missing_context",
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
              fetchSnapshot: (target) =>
                fetchSandboxCredentialSnapshot({
                  selector: target,
                  token: result.value.token,
                  teamId: result.value.team,
                  projectId: result.value.project,
                }),
            }),
        }));
      return {
        _tag: "ok",
        value: {
          ...result.value,
          appName:
            context.hotPath?.includes("vercel sandbox") ||
            (context.hotPath?.[0] === "vercel" &&
              context.hotPath?.[1] === "sandbox")
              ? "vercel sandbox"
              : "sandbox",
          creationRequested,
          interactive,
          ...(scopeProvenance ? { scopeProvenance } : {}),
          yes: run.yes,
          hasExplicitToken: context.nodes.some(
            (node) =>
              node.type === "longOption" &&
              node.key === "token" &&
              node.value !== undefined,
          ),
          ...(managed
            ? {
                managed,
                managedOptions,
              }
            : {}),
          ...(managedOptions.credentialsPersistConfiguration !== undefined
            ? {
                persistConfiguration:
                  managedOptions.credentialsPersistConfiguration,
              }
            : {}),
        },
      };
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
