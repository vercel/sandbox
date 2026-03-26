export type CommandResponse = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export type CommandHandlerContext = {
  stdin: string;
};

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

function createHandler(
  matchFn: (cmd: string, args: string[]) => boolean,
  response: CommandResponse | ResponseFn,
): CommandHandler {
  return {
    matches: matchFn,
    async resolve(_cmd, args, ctx) {
      return typeof response === "function" ? response(args, ctx) : response;
    },
  };
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

  return createHandler((cmd, args) => {
    if (cmd !== cmdName) return false;
    for (let i = 1; i < tokens.length; i++) {
      if (args[i - 1] !== tokens[i]) return false;
    }
    return true;
  }, response);
}

function createRegexHandler(
  pattern: RegExp,
  response: CommandResponse | ResponseFn,
): CommandHandler {
  return createHandler((cmd, args) => {
    const fullCmd = args.length ? `${cmd} ${args.join(" ")}` : cmd;
    const isStatefulRegex = pattern.global || pattern.sticky;
    if (isStatefulRegex) pattern.lastIndex = 0;
    const result = pattern.test(fullCmd);
    if (isStatefulRegex) pattern.lastIndex = 0;
    return result;
  }, response);
}
