import { describe, expect, test } from "vitest";
import { EMPTY_BYTES, encodeUtf8ToBytes } from "just-bash";
import { command, handlersToCustomCommands } from "./handlers";
import type { CommandHandlerContext } from "./handlers";

describe(command, () => {
  describe("string patterns", () => {
    test("empty string pattern throws", () => {
      expect(() => command("", { exitCode: 0 })).toThrow();
    });

    test("whitespace-only pattern throws", () => {
      expect(() => command("   ", { exitCode: 0 })).toThrow();
    });

    test("exact command name matches any invocation", () => {
      const handler = command("npm", { stdout: "ok" });
      expect(handler.commandNames).toEqual(["npm"]);
      expect(handler.matches("npm", [])).toBe(true);
      expect(handler.matches("npm", ["install"])).toBe(true);
      expect(handler.matches("npm", ["test", "--watch"])).toBe(true);
    });

    test("command with arg prefix matches correct invocation", () => {
      const handler = command("npm install", { stdout: "installed" });
      expect(handler.commandNames).toEqual(["npm"]);
      expect(handler.matches("npm", ["install"])).toBe(true);
      expect(handler.matches("npm", ["install", "--save"])).toBe(true);
      expect(handler.matches("npm", ["install", "--save", "lodash"])).toBe(true);
    });

    test("command with arg prefix does not match different args", () => {
      const handler = command("npm install", { stdout: "installed" });
      expect(handler.matches("npm", ["test"])).toBe(false);
      expect(handler.matches("npm", ["uninstall"])).toBe(false);
      expect(handler.matches("yarn", ["install"])).toBe(false);
    });

    test("command prefix matches invocations with extra args", () => {
      const handler = command("npm install", { stdout: "installed" });
      expect(handler.matches("npm", ["install", "--save", "react"])).toBe(true);
    });

    test("static response resolves correctly", async () => {
      const handler = command("npm", { stdout: "output", stderr: "error", exitCode: 1 });
      const ctx: CommandHandlerContext = { stdin: "" };
      const result = await handler.resolve("npm", [], ctx);
      expect(result).toEqual({ stdout: "output", stderr: "error", exitCode: 1 });
    });

    test("callback handler receives args and context", async () => {
      const handler = command("npm", (args, ctx) => {
        return {
          stdout: `args: ${args.join(",")} stdin: ${ctx.stdin}`,
        };
      });
      const ctx: CommandHandlerContext = { stdin: "test input" };
      const result = await handler.resolve("npm", ["install", "react"], ctx);
      expect(result.stdout).toBe("args: install,react stdin: test input");
    });

    test("async callback handler works", async () => {
      const handler = command("npm", async (args, _ctx) => {
        return {
          stdout: `async: ${args[0]}`,
        };
      });
      const ctx: CommandHandlerContext = { stdin: "" };
      const result = await handler.resolve("npm", ["test"], ctx);
      expect(result.stdout).toBe("async: test");
    });
  });

  describe("regex patterns", () => {
    test("regex handler extracts command name from /^npm/", () => {
      const handler = command(/^npm/, { stdout: "ok" });
      expect(handler.commandNames).toEqual(["npm"]);
    });

    test("regex handler matches full command string", () => {
      const handler = command(/^npm/, { stdout: "ok" });
      expect(handler.matches("npm", [])).toBe(true);
      expect(handler.matches("npm", ["install"])).toBe(true);
      expect(handler.matches("npm", ["install", "--save"])).toBe(true);
    });

    test("regex handler does not match different command", () => {
      const handler = command(/^npm/, { stdout: "ok" });
      expect(handler.matches("yarn", ["install"])).toBe(false);
      expect(handler.matches("node", ["script.js"])).toBe(false);
    });

    test("regex with alternation at start throws error", () => {
      expect(() => {
        command(/(npm|yarn)/, { stdout: "ok" });
      }).toThrow("Cannot extract command name from regex");
    });

    test("regex without leading literal throws error", () => {
      expect(() => {
        command(/.*/, { stdout: "ok" });
      }).toThrow("Cannot extract command name from regex");
    });

    test("regex with caret and literal extracts correctly", () => {
      const handler = command(/^npm install/, { stdout: "ok" });
      expect(handler.commandNames).toEqual(["npm"]);
      expect(handler.matches("npm", ["install"])).toBe(true);
      expect(handler.matches("npm", ["test"])).toBe(false);
    });

    test("regex with hyphenated command name", () => {
      const handler = command(/^npm-cli/, { stdout: "ok" });
      expect(handler.commandNames).toEqual(["npm-cli"]);
    });

    test("regex callback handler receives args", async () => {
      const handler = command(/^npm/, (args, _ctx) => {
        return { stdout: `matched: ${args.join(",")}` };
      });
      const ctx: CommandHandlerContext = { stdin: "" };
      const result = await handler.resolve("npm", ["install"], ctx);
      expect(result.stdout).toBe("matched: install");
    });

    test("global regex flag does not cause alternating match behavior", () => {
      const handler = command(/^echo/g, { stdout: "ok\n", exitCode: 0 });
      expect(handler.matches("echo", ["hi"])).toBe(true);
      expect(handler.matches("echo", ["hi"])).toBe(true);
      expect(handler.matches("echo", ["hi"])).toBe(true);
    });

    test("handler callback that throws propagates error", async () => {
      const handler = command("boom", () => {
        throw new Error("handler error");
      });
      await expect(handler.resolve("boom", [], { stdin: "" })).rejects.toThrow("handler error");
    });

    test("async handler callback resolves", async () => {
      const handler = command("slow", async () => {
        return { stdout: "done\n", exitCode: 0 };
      });
      const result = await handler.resolve("slow", [], { stdin: "" });
      expect(result.stdout).toBe("done\n");
    });

    test("handler can use exec to delegate to just-bash", async () => {
      const handler = command("wrapper", async (args, ctx) => {
        if (!ctx.exec) {
          return { stderr: "exec not available", exitCode: 1 };
        }
        return ctx.exec(args[0], args.slice(1));
      });
      const mockExec = async (cmd: string, args?: string[]) => ({
        stdout: `executed: ${cmd} ${args?.join(" ") ?? ""}`,
        stderr: "",
        exitCode: 0,
      });
      const ctx: CommandHandlerContext = { stdin: "", exec: mockExec };
      const result = await handler.resolve("wrapper", ["echo", "hello"], ctx);
      expect(result.stdout).toBe("executed: echo hello");
      expect(result.exitCode).toBe(0);
    });

    test("exec is optional in handler context", async () => {
      const handler = command("check-exec", async (_args, ctx) => {
        return {
          stdout: ctx.exec ? "exec available" : "exec not available",
          exitCode: 0,
        };
      });
      const ctxWithoutExec: CommandHandlerContext = { stdin: "" };
      const result = await handler.resolve("check-exec", [], ctxWithoutExec);
      expect(result.stdout).toBe("exec not available");
    });

    test("handler returning only exitCode gets defaults for stdout/stderr", async () => {
      const handler = command("minimal", { exitCode: 42 });
      const result = await handler.resolve("minimal", [], { stdin: "" });
      expect(result.exitCode).toBe(42);
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toBeUndefined();
    });
  });
});

describe(handlersToCustomCommands, () => {
  test("single handler produces one command", () => {
    const h1 = command("npm", { stdout: "ok" });
    const commands = handlersToCustomCommands([h1]);
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("npm");
  });

  test("multiple handlers for same command produce one command", () => {
    const h1 = command("npm install", { stdout: "install" });
    const h2 = command("npm test", { stdout: "test" });
    const commands = handlersToCustomCommands([h1, h2]);
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("npm");
  });

  test("handlers for different commands produce multiple commands", () => {
    const h1 = command("npm", { stdout: "npm" });
    const h2 = command("yarn", { stdout: "yarn" });
    const commands = handlersToCustomCommands([h1, h2]);
    expect(commands).toHaveLength(2);
    const names = commands.map((c) => c.name).sort();
    expect(names).toEqual(["npm", "yarn"]);
  });

  test("first matching handler wins (dispatch order)", async () => {
    const h1 = command("npm install", { stdout: "first" });
    const h2 = command("npm install", { stdout: "second" });
    const commands = handlersToCustomCommands([h1, h2]);
    const cmd = commands[0];

    const ctx = {
      fs: {} as any,
      cwd: "/",
      env: new Map<string, string>(),
      stdin: EMPTY_BYTES,
    };

    const result = await cmd.execute(["install"], ctx);
    expect(result.stdout).toBe("first");
  });

  test("no match returns exit code 127", async () => {
    const h1 = command("npm install", { stdout: "install" });
    const commands = handlersToCustomCommands([h1]);
    const cmd = commands[0];

    const ctx = {
      fs: {} as any,
      cwd: "/",
      env: new Map<string, string>(),
      stdin: EMPTY_BYTES,
    };

    const result = await cmd.execute(["test"], ctx);
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("command handler registered but no pattern matched");
  });

  test("handler response is converted to ExecResult", async () => {
    const h1 = command("npm", {
      stdout: "output",
      stderr: "error",
      exitCode: 42,
    });
    const commands = handlersToCustomCommands([h1]);
    const cmd = commands[0];

    const ctx = {
      fs: {} as any,
      cwd: "/",
      env: new Map<string, string>(),
      stdin: EMPTY_BYTES,
    };

    const result = await cmd.execute([], ctx);
    expect(result.stdout).toBe("output");
    expect(result.stderr).toBe("error");
    expect(result.exitCode).toBe(42);
  });

  test("default response values are applied", async () => {
    const h1 = command("npm", {});
    const commands = handlersToCustomCommands([h1]);
    const cmd = commands[0];

    const ctx = {
      fs: {} as any,
      cwd: "/",
      env: new Map<string, string>(),
      stdin: EMPTY_BYTES,
    };

    const result = await cmd.execute([], ctx);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("callback handler receives stdin from context", async () => {
    const h1 = command("npm", (args, ctx) => {
      return { stdout: `stdin: ${ctx.stdin}` };
    });
    const commands = handlersToCustomCommands([h1]);
    const cmd = commands[0];

    const ctx = {
      fs: {} as any,
      cwd: "/",
      env: new Map<string, string>(),
      stdin: encodeUtf8ToBytes("test input"),
    };

    const result = await cmd.execute([], ctx);
    expect(result.stdout).toBe("stdin: test input");
  });

  test("multiple handlers with different patterns dispatch correctly", async () => {
    const h1 = command("npm install", { stdout: "install" });
    const h2 = command("npm test", { stdout: "test" });
    const h3 = command("npm", { stdout: "default" });
    const commands = handlersToCustomCommands([h1, h2, h3]);
    const cmd = commands[0];

    const ctx = {
      fs: {} as any,
      cwd: "/",
      env: new Map<string, string>(),
      stdin: EMPTY_BYTES,
    };

    const r1 = await cmd.execute(["install"], ctx);
    expect(r1.stdout).toBe("install");

    const r2 = await cmd.execute(["test"], ctx);
    expect(r2.stdout).toBe("test");

    const r3 = await cmd.execute(["run", "build"], ctx);
    expect(r3.stdout).toBe("default");
  });

  test("exec is passed to handler when context has exec", async () => {
    const h1 = command("wrapper", async (args, ctx) => {
      if (!ctx.exec) {
        return { stderr: "exec not available", exitCode: 1 };
      }
      return ctx.exec(args[0], args.slice(1));
    });
    const commands = handlersToCustomCommands([h1]);
    const cmd = commands[0];

    const execResults = new Map<string, string>([
      ["echo hello", "hello\n"],
      ["cat /file.txt", "file contents\n"],
    ]);

    const ctx = {
      fs: {} as any,
      cwd: "/",
      env: new Map<string, string>(),
      stdin: EMPTY_BYTES,
      exec: async (cmdLine: string) => ({
        stdout: execResults.get(cmdLine) ?? "",
        stderr: "",
        exitCode: 0,
      }),
    };

    const result = await cmd.execute(["echo", "hello"], ctx);
    expect(result.stdout).toBe("hello\n");
    expect(result.exitCode).toBe(0);
  });

  test("exec is undefined when context lacks exec", async () => {
    const h1 = command("check", async (_args, ctx) => {
      return {
        stdout: ctx.exec ? "has exec" : "no exec",
        exitCode: 0,
      };
    });
    const commands = handlersToCustomCommands([h1]);
    const cmd = commands[0];

    const ctx = {
      fs: {} as any,
      cwd: "/",
      env: new Map<string, string>(),
      stdin: EMPTY_BYTES,
      // no exec
    };

    const result = await cmd.execute([], ctx);
    expect(result.stdout).toBe("no exec");
  });
});
