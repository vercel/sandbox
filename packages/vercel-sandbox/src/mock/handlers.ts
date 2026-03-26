export type CommandResponse = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export type CommandHandlerContext = {
  stdin: string;
};

export type CommandMatcher = string | RegExp;

export interface CommandHandler {
  matches(cmd: string, args: string[]): boolean;
  resolve(
    cmd: string,
    args: string[],
    ctx: CommandHandlerContext,
  ): Promise<CommandResponse>;
}

type ResponseFn = (
  args: string[],
  ctx: CommandHandlerContext,
) => CommandResponse | Promise<CommandResponse>;

export function command(
  pattern: string,
  response?: CommandResponse | ResponseFn,
): CommandHandler;
export function command(
  pattern: RegExp,
  response?: CommandResponse | ResponseFn,
): CommandHandler;
export function command(
  pattern: string | RegExp,
  response?: CommandResponse | ResponseFn,
): CommandHandler {
  const resolved = response ?? {};
  if (typeof pattern === "string") {
    return createStringHandler(pattern, resolved);
  }
  return createRegexHandler(pattern, resolved);
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
    matches(cmd: string, args: string[]): boolean {
      if (cmd !== cmdName) return false;
      for (let i = 1; i < tokens.length; i++) {
        if (args[i - 1] !== tokens[i]) return false;
      }
      return true;
    },
    async resolve(
      _cmd: string,
      args: string[],
      ctx: CommandHandlerContext,
    ): Promise<CommandResponse> {
      if (typeof response === "function") {
        return response(args, ctx);
      }
      return response;
    },
  };
}

function createRegexHandler(
  pattern: RegExp,
  response: CommandResponse | ResponseFn,
): CommandHandler {
  return {
    matches(cmd: string, args: string[]): boolean {
      const fullCmd = args.length ? `${cmd} ${args.join(" ")}` : cmd;
      const isStatefulRegex = pattern.global || pattern.sticky;
      if (isStatefulRegex) pattern.lastIndex = 0;
      const matches = pattern.test(fullCmd);
      if (isStatefulRegex) pattern.lastIndex = 0;
      return matches;
    },
    async resolve(
      _cmd: string,
      args: string[],
      ctx: CommandHandlerContext,
    ): Promise<CommandResponse> {
      if (typeof response === "function") {
        return response(args, ctx);
      }
      return response;
    },
  };
}
