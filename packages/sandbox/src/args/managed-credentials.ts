import * as cmd from "cmd-ts";
import type { ArgParser } from "cmd-ts/dist/esm/argparser";
import type { ProvidesHelp } from "cmd-ts/dist/esm/helpdoc";
import { ACCEPTED_API_ACTION_NAMES } from "../util/managed-credentials-config";

/** A parsed `--long[=value]` node, as produced by cmd-ts's parser. */
interface LongOptionNode {
  type: string;
  key: string;
  raw?: string;
  value?: { node: { raw: string } };
}

/**
 * Whether a bare argument looks like someone meant it as the flag's value.
 *
 * Used only to turn a confusing downstream error into a targeted hint, so it
 * errs toward obvious file paths rather than trying to classify every string.
 */
function looksLikePath(raw: string): boolean {
  return (
    raw.includes("/") ||
    raw.includes("\\") ||
    raw.startsWith(".") ||
    raw.startsWith("~") ||
    /\.json$/i.test(raw)
  );
}

/**
 * Find occurrences of one long option in the parsed argument list.
 *
 * cmd-ts exposes `findOption` only through a deep path that its package
 * exports do not expose at runtime, so the scan is reproduced here rather than
 * reaching into the dependency's internals.
 */
function findLongOption(nodes: readonly unknown[], long: string) {
  return (nodes as LongOptionNode[]).filter(
    (node) => node?.type === "longOption" && node.key === long,
  );
}

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
 * A long flag that takes an optional `=VALUE`.
 *
 * `cmd-ts` has no built-in optional-value option, so this registers the name as
 * a flag — which stops `--flag next-arg` from swallowing the next argument —
 * and reads the value only from the `--flag=VALUE` form. That is the usual
 * convention for optional-value flags (`git log --decorate[=short]`), and it
 * keeps `--credentials-persist-configuration` unambiguous when it is the last
 * argument on the line.
 *
 * Returns `undefined` when absent and `""` for the bare flag, so callers can
 * tell "not requested" from "requested with the default path".
 */
export function optionalValueFlag(config: {
  long: string;
  displayName: string;
  description: string;
}): ArgParser<string | undefined> & ProvidesHelp {
  return {
    register(opts) {
      opts.forceFlagLongNames.add(config.long);
    },
    helpTopics() {
      return [
        {
          category: "options",
          usage: `--${config.long}[=${config.displayName}]`,
          defaults: ["optional"],
          description: config.description,
        },
      ];
    },
    async parse({ nodes, visitedNodes }) {
      const found = findLongOption(nodes, config.long).filter(
        (node) => !visitedNodes.has(node as never),
      );
      for (const node of found) visitedNodes.add(node as never);

      if (found.length === 0) return { _tag: "ok", value: undefined };
      if (found.length > 1) {
        return {
          _tag: "error",
          error: {
            errors: [
              {
                nodes: found as never,
                message: `Expected 1 occurrence, got ${found.length}`,
              },
            ],
          },
        };
      }
      const value = found[0].value?.node.raw;
      if (value === undefined) {
        // `--flag value` leaves `value` as a positional, which later fails
        // against an unrelated argument (on `create`, the agent shortcut) with
        // a confusing message. Catch the likely intent and name the fix.
        const index = (nodes as LongOptionNode[]).indexOf(found[0]);
        const next = (nodes as LongOptionNode[])[index + 1];
        if (
          next?.type === "positionalArgument" &&
          typeof next.raw === "string" &&
          looksLikePath(next.raw)
        ) {
          return {
            _tag: "error",
            error: {
              errors: [
                {
                  nodes: [found[0], next] as never,
                  message: `--${config.long} takes its path with an equals sign. Use --${config.long}=${next.raw}, or pass the flag alone for the default path.`,
                },
              ],
            },
          };
        }
      }
      return { _tag: "ok", value: value ?? "" };
    },
  };
}

/**
 * The `--credentials-*` option surface.
 *
 * The naming stays forge-neutral on purpose: NPM, AI Gateway, and Linear
 * credentials are expected to join the same prefix later, so nothing here
 * says "github".
 */
export const managedCredentialOptions = {
  enableManagedCredentials: cmd.flag({
    long: "enable-managed-credentials",
    type: cmd.optional(cmd.boolean),
    description:
      "Request Vercel-managed GitHub credentials using inferred defaults for this repository. (experimental)",
  }),
  credentialsRepo: optionalString(
    "credentials-repo",
    "REPOSITORY",
    "GitHub OWNER/REPOSITORY for managed credentials; also the clone source. Defaults to the local Git remote. (experimental)",
  ),
  credentialsActions: cmd.multioption({
    long: "credentials-action",
    type: cmd.array({ ...cmd.string, displayName: "ACTION" }),
    description: `GitHub API action to request. Repeat the flag to add actions; supplying any replaces the default set (issues:read, issues:comment, pull-request:create). Accepted: ${ACCEPTED_API_ACTION_NAMES.join(", ")}. (experimental)`,
  }),
  credentialsCommitAs: optionalString(
    "credentials-commit-as",
    "IDENTITY",
    'Commit credit for managed Git pushes, as "Name <email>". Defaults to the effective local Git configuration. (experimental)',
  ),
  credentialsActAs: optionalString(
    "credentials-act-as",
    "USER",
    "GitHub username or numeric user ID to act as for API requests. Defaults to the active gh account, then the GitHub account linked to Vercel. (experimental)",
  ),
  credentialsNoWrite: cmd.flag({
    long: "credentials-no-write",
    type: cmd.optional(cmd.boolean),
    description:
      "Request a read-only clone (git:read) instead of Git write access. Leaves requested API actions unchanged. (experimental)",
  }),
  credentialsFromConfigFile: optionalString(
    "credentials-from-config-file",
    "FILE",
    "Read a complete managed-credentials configuration from a JSON file; - reads stdin. Supports multiple repositories and identities. (experimental)",
  ),
  credentialsFromSandbox: optionalString(
    "credentials-from-sandbox",
    "SELECTOR",
    "Reuse the managed-credentials configuration of an existing sandbox, by name or sbx_* identifier. Copies configuration only, never approval. (experimental)",
  ),
  credentialsPersistConfiguration: optionalValueFlag({
    long: "credentials-persist-configuration",
    displayName: "FILE",
    description:
      "After a successful creation, write the configuration as JSON for --credentials-from-config-file. Without =FILE, writes $PWD/<sbx_id>-credentials.json. (experimental)",
  }),
};

/** Flags that only describe how the command runs. */
export const executionOptions = {
  dryRun: cmd.flag({
    long: "dry-run",
    type: cmd.optional(cmd.boolean),
    description:
      "Resolve and show the managed-credentials configuration without creating a sandbox, changing policy, or writing files.",
  }),
};
