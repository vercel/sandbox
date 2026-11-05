import * as cmd from "cmd-ts";
import { ACCEPTED_CREATE_ACTION_NAMES } from "../util/managed-credentials-config";

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
 * The `--credentials-github-*` option surface.
 *
 * These flags configure GitHub credentials. Other providers can use their own
 * namespace without changing the meaning of these options.
 */
export const managedCredentialOptions = {
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
  credentialsActAs: optionalString(
    "credentials-github-act-as",
    "USER",
    "GitHub username or numeric user ID for the requested credentials and Git commit attribution. Defaults to the active gh account, then the Vercel-linked GitHub account. (experimental)",
  ),
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
  credentialsPersistConfiguration: optionalString(
    "credentials-github-persist-configuration",
    "FILE",
    "After successful creation, write the API-shaped credential configuration as JSON to this path. (experimental)",
  ),
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
