import * as cmd from "cmd-ts";
import { ACCEPTED_CREATE_ACTION_NAMES } from "../util/managed-credentials-config";

const optionalString = (
  long: string,
  displayName: string,
  description: string,
) => {
  const option = cmd.option({
    long,
    description,
    type: { ...cmd.optional(cmd.string), displayName },
  });
  return {
    ...option,
    async parse(context: Parameters<typeof option.parse>[0]) {
      const node = context.nodes.find(
        (node) => node.type === "longOption" && node.key === long,
      );
      if (
        node?.type === "longOption" &&
        (!node.value || node.value.node.raw === "")
      ) {
        return {
          _tag: "error" as const,
          error: {
            errors: [
              { nodes: [node], message: `--${long} requires ${displayName}.` },
            ],
          },
        };
      }
      return option.parse(context);
    },
  };
};

/**
 * Managed credential inputs for Sandbox creation.
 *
 * Shared options select providers or read their API configuration. GitHub
 * overrides use a provider-specific namespace.
 */
export const managedCredentialOptions = {
  credentialProviders: optionalString(
    "credentials",
    "PROVIDERS",
    "Comma-separated credential providers to request using inferred defaults. Cannot be combined with GitHub credential inputs. Supported: github. (experimental)",
  ),
  credentialsRepo: optionalString(
    "credentials-github-repo",
    "REPOSITORY",
    "GitHub OWNER/REPOSITORY for managed credentials; also the clone source. Defaults to the local Git remote. (experimental)",
  ),
  credentialsActions: cmd.multioption({
    long: "credentials-github-action",
    type: cmd.array({ ...cmd.string, displayName: "ACTIONS" }),
    description: `Comma-separated Git or GitHub API actions to request. Explicit actions replace the entire default set, including Git access. Accepted: ${ACCEPTED_CREATE_ACTION_NAMES.join(", ")}. (experimental)`,
  }),
  credentialsActAs: optionalString(
    "credentials-github-act-as",
    "USER",
    "GitHub username or numeric user ID for the requested credentials and Git commit attribution. Defaults to the active gh account, then the Vercel-linked GitHub account. (experimental)",
  ),
  credentialsFromConfigFile: optionalString(
    "credentials-file",
    "FILE",
    "Read the API credentials object from JSON; - reads stdin. GitHub groups are under github. (experimental)",
  ),
  credentialsFromSandbox: optionalString(
    "credentials-github-from-sandbox",
    "SELECTOR",
    "Reuse the managed-credentials configuration of an existing sandbox, by name or sbx_* identifier. Copies configuration only, never approval. (experimental)",
  ),
  credentialsPersistConfiguration: optionalString(
    "credentials-github-persist-configuration",
    "FILE",
    "After successful creation, write the API credentials object as JSON to this path. (experimental)",
  ),
};
