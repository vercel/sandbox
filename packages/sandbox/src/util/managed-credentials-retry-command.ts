import type { ParseContext } from "cmd-ts/dist/esm/argparser";
import {
  type ManagedCredentialsConfig,
  canonicalCreationAction,
  sourceRepository,
  repositoryUrl,
} from "./managed-credentials-config";

export type RetryInvocation = {
  appName: "sandbox" | "vercel sandbox";
  command: "create" | "run" | "sh";
  args: string[];
};

/** Capture parser inputs, not process.argv or the parser's remaining inputs. */
export function captureRetryInvocation(context: ParseContext): RetryInvocation {
  const path = context.hotPath ?? [];
  const leaf = path[path.length - 1];
  const command = leaf === "run" || leaf === "sh" ? leaf : "create";
  const appName =
    path.includes("vercel sandbox") ||
    (path[0] === "vercel" && path[1] === "sandbox")
      ? "vercel sandbox"
      : "sandbox";
  // Subcommand parsing visits its positional node but leaves it in nodes.
  // Do not discard other visited nodes: options and run/create positionals may
  // already have been parsed by the time createContext captures the invocation.
  const breadcrumbs = path.slice(1);
  let breadcrumb = 0;
  const args: string[] = [];
  for (const node of context.nodes) {
    if (
      breadcrumb < breadcrumbs.length &&
      node.type === "positionalArgument" &&
      node.raw === breadcrumbs[breadcrumb] &&
      context.visitedNodes.has(node)
    ) {
      breadcrumb++;
      continue;
    }
    if (node.type === "shortOptions") {
      // Rest arguments can include clusters meaningful to the child command.
      // Keep them intact; only the final option can have a parsed value.
      appendOption(
        args,
        `-${node.options.map((option) => option.key).join("")}`,
        node.options[node.options.length - 1]?.value,
      );
    } else if (node.type === "longOption" || node.type === "shortOption") {
      appendOption(
        args,
        `${node.type === "longOption" ? "--" : "-"}${node.key}`,
        node.value,
      );
    } else {
      args.push(node.raw);
    }
  }
  return { appName, command, args };
}

function appendOption(
  args: string[],
  flag: string,
  value?: { delimiter: { raw: string }; node: { raw: string } },
) {
  if (!value) args.push(flag);
  else if (value.delimiter.raw === "=") args.push(`${flag}=${value.node.raw}`);
  else args.push(flag, value.node.raw);
}

// Only options that describe the resolved proposal are replaced. Persistence
// describes a requested output, not access, and must survive a retry.
const replacedValues = new Set([
  "github-access",
  "scope",
  "team",
  "project",
  "vcpus",
  "credentials-github-repo",
  "credentials-github-action",
  "credentials-github-act-as",
  "credentials-github-commit-as",
  "credentials-github-from-config-file",
  "credentials-github-from-sandbox",
]);
const replacedFlags = new Set([
  "enable-github-credentials",
  "credentials-github-no-write",
  "yes",
]);

// Keep a value that resembles a flag attached to its own option. cmd-ts's
// forceOption parser consumes these even if they begin with a dash.
const preservedValues = new Set([
  "name",
  "runtime",
  "image",
  "timeout",
  "snapshot",
  "env",
  "tag",
  "mount",
  "region",
  "failover-regions",
  "network-id",
  "publish-port",
  "network-policy",
  "allowed-domain",
  "allowed-cidr",
  "denied-cidr",
  "request-header",
  "request-header-from-env",
  "network-policy-file",
  "snapshot-expiration",
  "keep-last-snapshots",
  "keep-last-snapshots-for",
  "delete-evicted-snapshots",
  "workdir",
]);

/**
 * Print the current proposal without approving it, writing a file, or looking
 * up mutable context. Non-inferable configurations travel as resolved JSON.
 */
export function renderManagedCredentialsRetryCommand(options: {
  config: ManagedCredentialsConfig;
  team: string;
  project: string;
  vcpus: number;
  invocation?: RetryInvocation;
}): string {
  const { config, team, project, vcpus } = options;
  const invocation = options.invocation ?? {
    appName: "sandbox",
    command: "create",
    args: [],
  };
  const explicit = [
    `--scope=${team}`,
    `--project=${project}`,
    `--vcpus=${vcpus}`,
  ];
  const direct = directFlags(config);
  const parts = [
    invocation.appName,
    invocation.command,
    ...explicit.map(shellQuote),
    ...(direct
      ? direct.map(shellQuote)
      : ['--credentials-github-from-config-file="$SANDBOX_RETRY_CONFIG"']),
    ...retainedArguments(invocation.args),
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
  // stdin stays available for network policy, shell input and interactive run.
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
  // Replay every explicit permission and actor. Missing values use the exact
  // configuration-file fallback instead of invoking fresh identity inference.
  if (config.commitAs) {
    const { name, email } = config.commitAs;
    // parseCommitAs trims names and does not accept newlines/angle brackets.
    // Preserve such imported identities in JSON rather than normalize them.
    if (
      name !== name.trim() ||
      !/^[^<>\r\n]+$/.test(name) ||
      !/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(email)
    )
      return;
  }
  return [
    `--credentials-github-repo=${repo}`,
    ...group.actions.map((action) => `--credentials-github-action=${action}`),
    `--credentials-github-act-as=${group.actAs}`,
    ...(config.commitAs
      ? [
          `--credentials-github-commit-as=${config.commitAs.name} <${config.commitAs.email}>`,
        ]
      : []),
  ];
}

function retainedArguments(args: readonly string[]): string[] {
  const result: string[] = [];
  let positional = false;
  let environment = 0;
  let childToken = 0;
  let header = 0;
  const envPlaceholder = () =>
    requiredVariable(
      `SANDBOX_RETRY_ENV_${++environment}`,
      `Set SANDBOX_RETRY_ENV_${environment} to the original env argument`,
    );
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      positional = true;
      result.push("--");
      continue;
    }
    const long = /^--([^=]+)(?:=([\s\S]*))?$/.exec(arg);
    if (long) {
      const [, key, inline] = long;
      // Redact even child-command credential arguments after --. Retain their
      // original split/equals form there, as they are not our option syntax.
      if (key === "token" || key === "env" || key === "request-header") {
        const tokenVariable = positional
          ? `SANDBOX_RETRY_TOKEN_${childToken + 1}`
          : "VERCEL_AUTH_TOKEN";
        if (key === "token" && positional) childToken++;
        const placeholder =
          key === "token"
            ? requiredVariable(tokenVariable, `Set ${tokenVariable}`)
            : key === "request-header"
              ? requiredVariable(
                  `SANDBOX_RETRY_HEADER_${++header}`,
                  `Set SANDBOX_RETRY_HEADER_${header} to the original domain:header=value argument`,
                )
              : envPlaceholder();
        if (positional && inline === undefined)
          result.push(`--${key}`, placeholder);
        else result.push(`--${key}=${placeholder}`);
        if (inline === undefined) index++;
        continue;
      }
      if (!positional && (replacedValues.has(key) || replacedFlags.has(key))) {
        if (inline === undefined && replacedValues.has(key)) index++;
        continue;
      }
      result.push(shellQuote(arg));
      if (
        !positional &&
        inline === undefined &&
        preservedValues.has(key) &&
        index + 1 < args.length
      )
        result.push(shellQuote(args[++index]));
      continue;
    }
    if (positional) {
      // In particular, node -e CODE is a literal child invocation, not --env.
      result.push(shellQuote(arg));
      continue;
    }
    const short = /^-([^-][^=]*)(?:=([\s\S]*))?$/.exec(arg);
    if (short) {
      const [, keys, inline] = short;
      const lastKey = keys[keys.length - 1];
      if (!keys.includes("y") && lastKey !== "e") {
        result.push(shellQuote(arg));
        if (
          inline === undefined &&
          ["s", "p", "w", "t"].includes(lastKey) &&
          index + 1 < args.length
        )
          result.push(shellQuote(args[++index]));
        continue;
      }
      // cmd-ts clusters flags; only the last short option can take a value.
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        const last = k === keys.length - 1;
        if (key === "y" && !positional) continue;
        if (key === "e" && last) {
          result.push("-e", envPlaceholder());
          if (inline === undefined) index++;
        } else if (last && inline !== undefined) {
          result.push(shellQuote(`-${key}=${inline}`));
        } else {
          result.push(shellQuote(`-${key}`));
          if (
            !positional &&
            last &&
            ["s", "p", "w", "t"].includes(key) &&
            index + 1 < args.length
          )
            result.push(shellQuote(args[++index]));
        }
      }
      continue;
    }
    result.push(shellQuote(arg));
  }
  return result;
}

function requiredVariable(name: string, message: string): string {
  // Both strings are generated constants, never input interpolated into shell.
  return `"\${${name}:?${message}}"`;
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
