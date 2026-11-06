import {
  type ManagedCredentialsConfig,
  githubActor,
  sourceRepository,
  repositoryUrl,
} from "./managed-credentials-config";
import type { InferredActor } from "./managed-credentials-identity";

/**
 * Print a direct-flag proposal without approving it or looking up mutable context.
 * Omit configurations that direct flags cannot preserve.
 */
export function renderManagedCredentialsRetryCommand(options: {
  config: ManagedCredentialsConfig;
  team: string;
  project: string;
  vcpus: number;
  actor?: InferredActor;
  appName?: "sandbox" | "vercel sandbox";
  /** Require the same explicit Vercel token through a non-printing placeholder. */
  hasExplicitToken?: boolean;
}): string | undefined {
  const { config, team, project, vcpus } = options;
  const direct = directFlags(config, options.actor);
  if (!direct) return;
  const explicit = [
    `--scope=${team}`,
    `--project=${project}`,
    `--vcpus=${vcpus}`,
  ];
  return [
    options.appName ?? "sandbox",
    "create",
    ...explicit.map(shellQuote),
    ...(options.hasExplicitToken
      ? [
          '--token="${VERCEL_AUTH_TOKEN:?Set VERCEL_AUTH_TOKEN to the original Vercel token}"',
        ]
      : []),
    ...direct.map(shellQuote),
  ].join(" ");
}

/** Only emit direct flags when they preserve the source and requested rights. */
function directFlags(
  config: ManagedCredentialsConfig,
  actor?: InferredActor,
): string[] | undefined {
  const source = config.source;
  const repo = sourceRepository(config);
  const groups = config.credentials.github;
  if (
    !source ||
    !repo ||
    source.url !== repositoryUrl(repo) ||
    source.revision !== undefined ||
    source.depth !== undefined ||
    groups.length !== 1 ||
    groups[0].repositories.length !== 1 ||
    groups[0].repositories[0] !== repo
  )
    return;
  const group = groups[0];
  if (group.actAs === undefined) return;
  const username =
    !group.actAs.startsWith("@") && actor?.actAs === group.actAs && actor.login
      ? githubActor.safeParse(`@${actor.login.replace(/^@/, "")}`)
      : undefined;
  return [
    `--credentials-github-repo=${repo}`,
    ...group.actions.map((action) => `--credentials-github-action=${action}`),
    `--credentials-github-act-as=${username?.success ? username.data : group.actAs}`,
  ];
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  if (/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/.test(value)) {
    // UTF-8 octal bytes work in Bash (including macOS Bash 3) and zsh,
    // independently of locale. No raw controls or expandable input reach the
    // terminal, and trailing newlines survive without command substitution.
    return `$'${Array.from(
      Buffer.from(value, "utf8"),
      (byte) => `\\${byte.toString(8).padStart(3, "0")}`,
    ).join("")}'`;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
