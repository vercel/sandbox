import { decodeBytesToUtf8, defineCommand } from "just-bash";
import type { Command, CommandContext, ExecResult } from "just-bash";

export type CommandResponse = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export type CommandHandlerContext = {
  stdin: string;
  /**
   * Execute a command through just-bash. Available when running inside a
   * sandbox session. Use this to delegate to the underlying shell (e.g., a
   * `runuser` handler can use `exec` to run the wrapped command).
   */
  exec?: (
    cmd: string,
    args?: string[],
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
};

export type CommandMatcher = string | RegExp;

export interface CommandHandler {
  commandNames: string[];
  matches(cmd: string, args: string[]): boolean;
  resolve(cmd: string, args: string[], ctx: CommandHandlerContext): Promise<CommandResponse>;
}

type ResponseFn = (
  args: string[],
  ctx: CommandHandlerContext,
) => CommandResponse | Promise<CommandResponse>;

/**
 * Create a command handler from a string pattern or regex.
 * String patterns match exact prefixes (e.g., 'npm install' matches 'npm install --save').
 * Regex patterns match the full command line.
 */
export function command(
  pattern: string | RegExp,
  response: CommandResponse | ResponseFn = {},
): CommandHandler {
  if (typeof pattern === "string") {
    return createStringHandler(pattern, response);
  } else {
    return createRegexHandler(pattern, response);
  }
}

function createStringHandler(
  pattern: string,
  response: CommandResponse | ResponseFn,
): CommandHandler {
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) {
    throw new Error("Command pattern must not be empty");
  }

  const tokens = normalizedPattern.split(/\s+/);
  const cmdName = tokens[0];

  return {
    commandNames: [cmdName],
    matches(cmd: string, args: string[]): boolean {
      if (cmd !== cmdName) return false;
      // Check if all pattern tokens (after the first) match the args
      for (let i = 1; i < tokens.length; i++) {
        if (args[i - 1] !== tokens[i]) return false;
      }
      return true;
    },
    async resolve(
      cmd: string,
      args: string[],
      ctx: CommandHandlerContext,
    ): Promise<CommandResponse> {
      if (typeof response === "function") {
        return await response(args, ctx);
      }
      return response;
    },
  };
}

function createRegexHandler(
  pattern: RegExp,
  response: CommandResponse | ResponseFn,
): CommandHandler {
  const cmdName = extractCommandName(pattern);

  return {
    commandNames: [cmdName],
    matches(cmd: string, args: string[]): boolean {
      const fullCmd = args.length ? `${cmd} ${args.join(" ")}` : cmd;
      const isStatefulRegex = pattern.global || pattern.sticky;
      if (isStatefulRegex) pattern.lastIndex = 0;
      const matches = pattern.test(fullCmd);
      if (isStatefulRegex) pattern.lastIndex = 0;
      return matches;
    },
    async resolve(
      cmd: string,
      args: string[],
      ctx: CommandHandlerContext,
    ): Promise<CommandResponse> {
      if (typeof response === "function") {
        return await response(args, ctx);
      }
      return response;
    },
  };
}

function extractCommandName(regex: RegExp): string {
  // Try to extract command name from regex source
  // Look for /^cmd or /cmd at the start
  const source = regex.source;
  const match = source.match(/^\^?(\w[\w-]*)/);
  if (!match) {
    throw new Error(
      "Cannot extract command name from regex — pattern must start with a literal command name (e.g., /^npm/ or /npm/)",
    );
  }
  return match[1];
}

/** Shared handler registry used by Sandbox.create() and setupSandbox(). */
export let defaultHandlers: CommandHandler[] = [];
export let runtimeHandlers: CommandHandler[] = [];
const resetCallbacks: Array<() => void> = [];

export function onResetHandlers(cb: () => void): void {
  resetCallbacks.push(cb);
}

export type SandboxServer = {
  use: (...handlers: CommandHandler[]) => void;
  resetHandlers: () => void;
};

export function setupSandbox(...handlers: CommandHandler[]): SandboxServer {
  defaultHandlers = handlers;
  runtimeHandlers = [];

  return {
    use(...handlers: CommandHandler[]) {
      runtimeHandlers.unshift(...handlers);
    },
    resetHandlers() {
      runtimeHandlers = [];
      for (const cb of resetCallbacks) cb();
    },
  };
}

/**
 * Convert an array of CommandHandlers to just-bash Command objects.
 * Groups handlers by command name and creates a defineCommand for each.
 */
export function handlersToCustomCommands(handlers: CommandHandler[]): Command[] {
  // Group handlers by command name
  const handlersByName = new Map<string, CommandHandler[]>();
  for (const handler of handlers) {
    for (const name of handler.commandNames) {
      if (!handlersByName.has(name)) {
        handlersByName.set(name, []);
      }
      handlersByName.get(name)!.push(handler);
    }
  }

  // Create a Command for each unique command name
  const commands: Command[] = [];
  for (const [name, nameHandlers] of Array.from(handlersByName)) {
    const cmd = defineCommand(
      name,
      async (args: string[], ctx: CommandContext): Promise<ExecResult> => {
        // Provide exec so handlers can delegate to just-bash
        const exec = ctx.exec
          ? async (execCmd: string, execArgs?: string[]) => {
              const cmdLine = execArgs?.length ? [execCmd, ...execArgs].join(" ") : execCmd;
              return ctx.exec!(cmdLine, { cwd: ctx.cwd });
            }
          : undefined;

        // Try each handler in registration order
        for (const handler of nameHandlers) {
          if (handler.matches(name, args)) {
            const result = await handler.resolve(name, args, {
              stdin: decodeBytesToUtf8(ctx.stdin),
              exec,
            });
            return {
              stdout: result.stdout ?? "",
              stderr: result.stderr ?? "",
              exitCode: result.exitCode ?? 0,
            };
          }
        }

        // No handler matched
        return {
          stdout: "",
          stderr: `${name}: command handler registered but no pattern matched invocation\n`,
          exitCode: 127,
        };
      },
    );
    commands.push(cmd);
  }

  return commands;
}
