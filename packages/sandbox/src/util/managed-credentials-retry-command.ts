import {
  type ManagedCredentialsConfig,
  canonicalCreationAction,
  sourceRepository,
  repositoryUrl,
} from "./managed-credentials-config";

/**
 * Print the current proposal without approving it, writing a file, or looking
 * up mutable context. Non-inferable configurations travel as resolved JSON.
 */
export function renderManagedCredentialsRetryCommand(options: {
  config: ManagedCredentialsConfig;
  team: string;
  project: string;
  vcpus: number;
  appName?: "sandbox" | "vercel sandbox";
  /** Require the same explicit Vercel token through a non-printing placeholder. */
  hasExplicitToken?: boolean;
}): string {
  const { config, team, project, vcpus } = options;
  const explicit = [
    `--scope=${team}`,
    `--project=${project}`,
    `--vcpus=${vcpus}`,
  ];
  const direct = directFlags(config);
  const parts = [
    options.appName ?? "sandbox",
    "create",
    ...explicit.map(shellQuote),
    ...(options.hasExplicitToken
      ? [
          '--token="${VERCEL_AUTH_TOKEN:?Set VERCEL_AUTH_TOKEN to the original Vercel token}"',
        ]
      : []),
    ...(direct
      ? direct.map(shellQuote)
      : ['--credentials-github-from-config-file="$SANDBOX_RETRY_CONFIG"']),
  ];
  const command = parts.join(" ");
  if (direct) return command;

  // JSON escaping also prevents terminal control sequences from reaching the
  // review screen. Quoting the delimiter disables ALL heredoc expansion.
  const json = JSON.stringify(config, null, 2).replace(
    /[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,
    unicodeEscape,
  );
  let delimiter = "SANDBOX_MANAGED_CREDENTIALS";
  while (json.includes(delimiter)) delimiter += "_";
  // This is only text until the user runs it. Use a regular, private file so
  // stdin stays available for the creation confirmation.
  // All shell variable names/trap bodies are fixed, never taken from inputs.
  return `(
  umask 077
  SANDBOX_RETRY_CONFIG=$(mktemp "\${TMPDIR:-/tmp}/sandbox-managed-credentials.XXXXXXXXXX") || exit
  trap 'rm -f -- "$SANDBOX_RETRY_CONFIG"' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  cat >"$SANDBOX_RETRY_CONFIG" <<'${delimiter}' || exit
${json}
${delimiter}
  ${command}
)`;
}

/** Only emit direct flags when their inference can reproduce every field. */
function directFlags(config: ManagedCredentialsConfig): string[] | undefined {
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
  if (
    group.actions.length === 0 ||
    group.actions.some(
      (action) => canonicalCreationAction(action) !== action,
    ) ||
    new Set(group.actions).size !== group.actions.length ||
    !group.actAs
  )
    return;
  return [
    `--credentials-github-repo=${repo}`,
    ...group.actions.map((action) => `--credentials-github-action=${action}`),
    `--credentials-github-act-as=${group.actAs}`,
  ];
}

function unicodeEscape(char: string): string {
  return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
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
