import type { ParseContext } from "cmd-ts/dist/esm/argparser";
import {
  type ManagedCredentialsConfig,
  canonicalCreationAction,
  sourceRepository,
  repositoryUrl,
} from "./managed-credentials-config";

/**
 * One argument as the parser understood it.
 *
 * Keeping the parsed unit — rather than flattening to strings and matching
 * them with regular expressions again — means the association between an
 * option and its value survives. The parser already knows which options take a
 * value, so recovery never has to keep its own list of them in sync, and a
 * value that merely looks like a flag cannot be mistaken for one.
 */
export type RetryArgument =
  /** `--key`, `--key=value`, `-k`, or a `-abc` cluster. `inline` is the `=` form. */
  | {
      kind: "option";
      dash: "--" | "-";
      keys: string;
      value?: string;
      inline?: boolean;
    }
  /** A bare argument, including everything the child command receives. */
  | { kind: "positional"; raw: string }
  /** The `--` that hands the rest of the line to the child command. */
  | { kind: "separator" };

export type RetryInvocation = {
  appName: "sandbox" | "vercel sandbox";
  command: "create" | "run" | "sh";
  args: RetryArgument[];
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
  const args: RetryArgument[] = [];
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
      args.push(
        option(
          "-",
          node.options.map((entry) => entry.key).join(""),
          node.options[node.options.length - 1]?.value,
        ),
      );
    } else if (node.type === "longOption") {
      args.push(option("--", node.key, node.value));
    } else if (node.type === "shortOption") {
      args.push(option("-", node.key, node.value));
    } else if (node.type === "forcePositional") {
      args.push({ kind: "separator" });
    } else {
      args.push({ kind: "positional", raw: node.raw });
    }
  }
  return { appName, command, args };
}

function option(
  dash: "--" | "-",
  keys: string,
  value?: { delimiter: { raw: string }; node: { raw: string } },
): RetryArgument {
  if (!value) return { kind: "option", dash, keys };
  return {
    kind: "option",
    dash,
    keys,
    value: value.node.raw,
    inline: value.delimiter.raw === "=",
  };
}

// Only options that describe the resolved proposal are replaced. Persistence
// describes a requested output, not access, and must survive a retry.
const replacedValues = new Set([
  "scope",
  "team",
  "project",
  "vcpus",
  "credentials-github-repo",
  "credentials-github-action",
  "credentials-github-act-as",
  "credentials-github-from-config-file",
  "credentials-github-from-sandbox",
]);
const replacedFlags = new Set(["enable-github-credentials", "yes"]);

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
  // No flag can express imported commit credit, so such a configuration
  // travels as exact JSON rather than being normalized or silently dropped.
  if (config.commitAs) return;
  return [
    `--credentials-github-repo=${repo}`,
    ...group.actions.map((action) => `--credentials-github-action=${action}`),
    `--credentials-github-act-as=${group.actAs}`,
  ];
}

function retainedArguments(args: readonly RetryArgument[]): string[] {
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
  /** Re-emit an option in the exact split or `=` form it was written in. */
  const emit = (arg: RetryArgument & { kind: "option" }, value?: string) => {
    const flag = `${arg.dash}${arg.keys}`;
    if (value === undefined) result.push(shellQuote(flag));
    else if (arg.inline) result.push(shellQuote(`${flag}=${value}`));
    else result.push(shellQuote(flag), shellQuote(value));
  };

  for (const arg of args) {
    if (arg.kind === "separator") {
      positional = true;
      result.push("--");
      continue;
    }
    if (arg.kind === "positional") {
      // In particular, node -e CODE is a literal child invocation, not --env.
      result.push(shellQuote(arg.raw));
      continue;
    }
    if (arg.dash === "--") {
      const key = arg.keys;
      // Redact even child-command credential arguments after --. Retain their
      // original split/equals form there, as they are not our option syntax.
      if (key === "token" || key === "env" || key === "request-header") {
        let placeholder: string;
        if (key === "token") {
          // Only a child-command token consumes a number, so the placeholders
          // stay consecutive when env or header arguments sit between them.
          const name = positional
            ? `SANDBOX_RETRY_TOKEN_${++childToken}`
            : "VERCEL_AUTH_TOKEN";
          placeholder = requiredVariable(name, `Set ${name}`);
        } else if (key === "request-header") {
          placeholder = requiredVariable(
            `SANDBOX_RETRY_HEADER_${++header}`,
            `Set SANDBOX_RETRY_HEADER_${header} to the original domain:header=value argument`,
          );
        } else {
          placeholder = envPlaceholder();
        }
        // Placeholders are already quoted shell expansions, so emit them raw.
        if (positional && !arg.inline) result.push(`--${key}`, placeholder);
        else result.push(`--${key}=${placeholder}`);
        continue;
      }
      if (!positional && (replacedValues.has(key) || replacedFlags.has(key)))
        continue;
      emit(arg, arg.value);
      continue;
    }

    // cmd-ts clusters short flags; only the last one can carry a value.
    const keys = arg.keys;
    if (!keys.includes("y") && keys[keys.length - 1] !== "e") {
      emit(arg, arg.value);
      continue;
    }
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      const last = k === keys.length - 1;
      if (key === "y" && !positional) continue;
      if (key === "e" && last) result.push("-e", envPlaceholder());
      else
        emit(
          {
            kind: "option",
            dash: "-",
            keys: key,
            ...(arg.inline ? { inline: true } : {}),
          },
          last ? arg.value : undefined,
        );
    }
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
