import * as cmd from "cmd-ts";
import type { ArgParser } from "cmd-ts/dist/esm/argparser";
import type { ProvidesHelp } from "cmd-ts/dist/esm/helpdoc";
import { ACCEPTED_CREATE_ACTION_NAMES } from "../util/managed-credentials-config";
import { GITHUB_ACCESS_LEVELS } from "../util/managed-credentials-github-access";

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
 * keeps `--credentials-github-persist-configuration` unambiguous when it is the last
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

const githubAccess = cmd.option({
  long: "github-access",
  type: {
    ...cmd.optional(cmd.oneOf([...GITHUB_ACCESS_LEVELS])),
    displayName: "read|write",
  },
  description:
    "Select a fixed Git and GitHub API action set. The read preset requires git:read, which the current creation API does not support. Do not combine with explicit actions or configuration sources. (experimental)",
});

/**
 * The `--credentials-github-*` option surface.
 *
 * These flags configure GitHub credentials. Other providers can use their own
 * namespace without changing the meaning of these options.
 */
export const managedCredentialOptions = {
  githubAccess: {
    ...githubAccess,
    register() {
      // Enum values cannot begin with a dash. Keep a following flag separate.
    },
    async parse(context: Parameters<typeof githubAccess.parse>[0]) {
      // cmd-ts otherwise treats a valueless optional option as absent.
      const missing = context.nodes.filter(
        (node) =>
          node.type === "longOption" &&
          node.key === "github-access" &&
          !context.visitedNodes.has(node) &&
          (node.value === undefined ||
            !(GITHUB_ACCESS_LEVELS as readonly string[]).includes(
              node.value.node.raw,
            )),
      );
      if (missing.length > 0) {
        return {
          _tag: "error" as const,
          error: {
            errors: [
              {
                nodes: missing,
                message: "--github-access requires read or write.",
              },
            ],
          },
        };
      }
      return githubAccess.parse(context);
    },
  },
  enableManagedCredentials: cmd.flag({
    long: "enable-github-credentials",
    type: cmd.optional(cmd.boolean),
    description:
      "Request Vercel-managed GitHub credentials using inferred defaults for this repository. (experimental)",
  }),
  credentialsRepo: optionalString(
    "credentials-github-repo",
    "REPOSITORY",
    "GitHub OWNER/REPOSITORY for managed credentials; also the clone source. Defaults to the local Git remote. (experimental)",
  ),
  credentialsActions: cmd.multioption({
    long: "credentials-github-action",
    type: cmd.array({ ...cmd.string, displayName: "ACTION" }),
    description: `Git or GitHub API action to request. Repeat the flag to add actions. Explicit actions replace the entire default set, including Git access. Accepted: ${ACCEPTED_CREATE_ACTION_NAMES.join(", ")}. (experimental)`,
  }),
  credentialsCommitAs: optionalString(
    "credentials-github-commit-as",
    "IDENTITY",
    'Deprecated explicit commit credit override, as "Name <email>". Normal Git attribution comes from the selected GitHub actor. (experimental)',
  ),
  credentialsActAs: optionalString(
    "credentials-github-act-as",
    "USER",
    "GitHub username or numeric user ID for the requested credentials and Git commit attribution. Defaults to the active gh account, then the Vercel-linked GitHub account. (experimental)",
  ),
  credentialsNoWrite: cmd.flag({
    long: "credentials-github-no-write",
    type: cmd.optional(cmd.boolean),
    description:
      "Legacy read-only Git request. The current Sandbox creation API does not support git:read; the CLI rejects this flag without granting write access. (experimental)",
  }),
  credentialsFromConfigFile: optionalString(
    "credentials-github-from-config-file",
    "FILE",
    "Read API-shaped source and credentials fields from JSON; - reads stdin. Uses source.url and credentials.github[].repositories. (experimental)",
  ),
  credentialsFromSandbox: optionalString(
    "credentials-github-from-sandbox",
    "SELECTOR",
    "Reuse the managed-credentials configuration of an existing sandbox, by name or sbx_* identifier. Copies configuration only, never approval. (experimental)",
  ),
  credentialsPersistConfiguration: optionalValueFlag({
    long: "credentials-github-persist-configuration",
    displayName: "FILE",
    description:
      "After successful creation, write the API-shaped credential configuration as JSON. Without =FILE, writes $PWD/<sbx_id>-credentials.json. (experimental)",
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
