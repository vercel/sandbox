import * as cmd from "cmd-ts";
import type { ParsingInto } from "cmd-ts/dist/esm/argparser";
import {
  SANDBOX_GITHUB_CREDENTIAL_ACTIONS,
  type SandboxCredentials,
  type SandboxGitHubCredentialAction,
} from "@vercel/sandbox";
import { fail } from "../util/fail";
import { readJsonInput } from "../util/read-json-input";

export const CREDENTIAL_PROVIDERS = ["npm"] as const;
export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number];

function isCredentialProvider(value: string): value is CredentialProvider {
  return (CREDENTIAL_PROVIDERS as readonly string[]).includes(value);
}

function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== ""),
    ),
  ];
}

export const credentialProviderListType = cmd.extendType(cmd.string, {
  displayName: "PROVIDER,...",
  async from(value) {
    const providers = splitList(value);
    if (providers.length === 0) {
      throw new Error("Credentials cannot be empty.");
    }
    const unsupported = providers.filter(
      (provider) => !isCredentialProvider(provider),
    );
    if (unsupported.length > 0) {
      throw new Error(
        `Unsupported credentials: ${unsupported.join(", ")}. Supported: ${CREDENTIAL_PROVIDERS.join(", ")}.`,
      );
    }
    return providers.filter(isCredentialProvider);
  },
});

export const credentials = cmd.option({
  long: "credentials",
  type: cmd.optional(credentialProviderListType),
  description:
    "Comma-separated Vercel managed credentials to inject into the sandbox network policy.",
});

/**
 * The actions --credentials-github-repository requests when
 * --credentials-github-actions is absent: enough to read an issue and open a
 * pull request for it.
 */
export const DEFAULT_GITHUB_ACTIONS: readonly SandboxGitHubCredentialAction[] =
  [
    "github:issues:read",
    "github:issues:comment",
    "github:pull-request:create",
    "git:write",
  ];

const GITHUB_OWNER = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?";
const GITHUB_REPOSITORY = new RegExp(`^${GITHUB_OWNER}/[A-Za-z0-9._-]{1,100}$`);
const GITHUB_USER_ID = /^[1-9][0-9]{0,15}$/;
const GITHUB_USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,37}[A-Za-z0-9])?$/;

function isGithubRepository(value: string): boolean {
  return (
    GITHUB_REPOSITORY.test(value) && ![".", ".."].includes(value.split("/")[1])
  );
}

function isGithubAction(value: string): value is SandboxGitHubCredentialAction {
  return (SANDBOX_GITHUB_CREDENTIAL_ACTIONS as readonly string[]).includes(
    value,
  );
}

function isGithubActor(value: string): boolean {
  return value.startsWith("@")
    ? GITHUB_USERNAME.test(value.slice(1))
    : GITHUB_USER_ID.test(value);
}

export const githubRepositoryType = cmd.extendType(cmd.string, {
  displayName: "REPOSITORY",
  async from(value) {
    if (!isGithubRepository(value)) {
      fail(
        `Invalid GitHub repository: ${value}.`,
        "Use OWNER/REPOSITORY, for example acme/web.",
      );
    }
    return value;
  },
});

export const githubActionListType = cmd.extendType(cmd.string, {
  displayName: "ACTION,...",
  async from(value) {
    const items = splitList(value);
    if (items.length === 0) {
      throw new Error("GitHub actions cannot be empty.");
    }
    // GitHub API actions may drop their prefix: issues:read is
    // github:issues:read. Git actions always keep git:.
    const named = items.map((item) =>
      item.startsWith("git:") || item.startsWith("github:")
        ? item
        : `github:${item}`,
    );
    const unsupported = items.filter(
      (_, index) => !isGithubAction(named[index]),
    );
    if (unsupported.length > 0) {
      fail(
        `Unsupported GitHub actions: ${unsupported.join(", ")}.`,
        `Supported: ${SANDBOX_GITHUB_CREDENTIAL_ACTIONS.join(", ")}.`,
      );
    }
    return [...new Set(named.filter(isGithubAction))];
  },
});

export const githubActorType = cmd.extendType(cmd.string, {
  displayName: "USER",
  async from(value) {
    // Digits alone are a user ID. Every other value is a username.
    const actor =
      /^[0-9]+$/.test(value) || value.startsWith("@") ? value : `@${value}`;
    if (!isGithubActor(actor)) {
      fail(
        `Invalid GitHub user: ${value}.`,
        "Use a GitHub username, for example octocat, or a numeric GitHub user ID.",
      );
    }
    return actor;
  },
});

export const credentialsGithubRepository = cmd.option({
  long: "credentials-github-repository",
  type: cmd.optional(githubRepositoryType),
  description: `GitHub repository, as OWNER/REPOSITORY, to clone into the sandbox and give it Git and GitHub API access to, with Vercel managed credentials and no GitHub token inside the sandbox. Without --credentials-github-actions, the sandbox may: ${DEFAULT_GITHUB_ACTIONS.join(", ")}. (experimental)`,
});

export const credentialsGithubActions = cmd.option({
  long: "credentials-github-actions",
  type: cmd.optional(githubActionListType),
  description: `Comma-separated actions the sandbox may perform on the repository. They replace the default actions, including Git access. GitHub API actions may drop the github: prefix, for example issues:read. Supported: ${SANDBOX_GITHUB_CREDENTIAL_ACTIONS.join(", ")}. (experimental)`,
});

export const credentialsGithubActAs = cmd.option({
  long: "credentials-github-act-as",
  type: cmd.optional(githubActorType),
  description:
    "GitHub username or numeric user ID the sandbox acts as, which also authors its commits. Defaults to the GitHub account connected to your Vercel account. (experimental)",
});

/**
 * The credentials JSON shape, shown in --help and in validation errors. A test
 * reads a file that uses every field listed here.
 */
export const CREDENTIALS_FILE_SCHEMA = `The file holds the SDK's credentials option as JSON. Keys marked ? are optional; unknown keys are rejected.
      credentials = { "npm"?: true, "github"?: [grant, ...] }
      grant       = { "repositories": ["<OWNER/REPOSITORY>", ...], "actions": ["<action>", ...],
                      "actAs"?: "<numeric GitHub user ID>" | "@<username>" }
    Each grant gives its actions on its repositories. Actions use their full names, as listed for --credentials-github-actions.
    Example: {"github":[{"repositories":["acme/web"],"actions":["git:write","github:pull-request:create"],"actAs":"@octocat"}]}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeyIssues(
  value: Record<string, unknown>,
  known: readonly string[],
  prefix: string,
): string[] {
  return Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => `${prefix}${key}: unknown key`);
}

function listIssues(
  value: unknown,
  path: string,
  isValid: (item: string) => boolean,
  message: string,
): string[] {
  if (!Array.isArray(value)) {
    return [`${path}: must be a list`];
  }
  if (value.length === 0) {
    return [`${path}: must not be empty`];
  }
  return value.flatMap((item, index) =>
    typeof item === "string" && isValid(item)
      ? []
      : [`${path}[${index}]: ${message}`],
  );
}

function githubGrantIssues(grant: unknown, path: string): string[] {
  if (!isRecord(grant)) {
    return [`${path}: must be an object`];
  }
  return [
    ...unknownKeyIssues(
      grant,
      ["repositories", "actions", "actAs"],
      `${path}.`,
    ),
    ...listIssues(
      grant.repositories,
      `${path}.repositories`,
      isGithubRepository,
      "must be OWNER/REPOSITORY",
    ),
    ...listIssues(
      grant.actions,
      `${path}.actions`,
      isGithubAction,
      "unsupported action",
    ),
    ...("actAs" in grant &&
    !(typeof grant.actAs === "string" && isGithubActor(grant.actAs))
      ? [
          `${path}.actAs: must be a numeric GitHub user ID or an @-prefixed username`,
        ]
      : []),
  ];
}

/**
 * Lists what stops a JSON value from being a credentials request. Issues name
 * the path of a problem, never its value.
 */
function credentialsIssues(json: unknown): string[] {
  if (!isRecord(json)) {
    return ["must be an object"];
  }
  if (Object.keys(json).length === 0) {
    return ["must request at least one of npm or github"];
  }
  return [
    ...unknownKeyIssues(json, ["npm", "github"], ""),
    ...("npm" in json && json.npm !== true ? ["npm: must be true"] : []),
    ...(!("github" in json)
      ? []
      : !Array.isArray(json.github)
        ? ["github: must be a list"]
        : json.github.flatMap((grant, index) =>
            githubGrantIssues(grant, `github[${index}]`),
          )),
  ];
}

/**
 * Reads a credentials request from a JSON file, or from stdin when `path` is
 * `-`. Errors name the file and the JSON path of a problem, never the content.
 */
export async function readCredentialsFile(
  path: string,
  read?: (path: string) => Promise<string>,
): Promise<SandboxCredentials> {
  const { json, source } = await readJsonInput(
    path,
    {
      option: "--credentials-file",
      subject: "credentials",
      verb: "are",
      shapeHint: CREDENTIALS_FILE_SCHEMA,
    },
    read,
  );

  const issues = credentialsIssues(json);
  if (issues.length > 0) {
    fail(
      [
        `The credentials in ${source} are invalid:`,
        ...issues.map((issue) => `  ${issue}`),
      ].join("\n"),
      CREDENTIALS_FILE_SCHEMA,
    );
  }
  return json as SandboxCredentials;
}

const credentialsFileType = cmd.extendType(cmd.string, {
  displayName: "FILE",
  async from(path) {
    return readCredentialsFile(path);
  },
});

export const credentialsFile = cmd.option({
  long: "credentials-file",
  type: cmd.optional(credentialsFileType),
  description: `Read the whole credentials request from a JSON file (use - for stdin). Use it for requests the other options cannot express, such as several repositories. Nothing is cloned into the sandbox. Cannot be combined with the other credentials options. (experimental)
    ${CREDENTIALS_FILE_SCHEMA}`,
});

export const credentialsArgs = {
  credentials,
  credentialsGithubRepository,
  credentialsGithubActions,
  credentialsGithubActAs,
  credentialsFile,
} as const;

export type CredentialsArgs = {
  [K in keyof typeof credentialsArgs]: ParsingInto<(typeof credentialsArgs)[K]>;
};
