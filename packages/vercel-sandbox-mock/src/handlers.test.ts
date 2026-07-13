import { Bash } from "just-bash";
import { describe, expect, test } from "vitest";
import { command, handlersToCustomCommands } from "./handlers";

const ctx = { stdin: "" };

describe("command()", () => {
  describe("string patterns", () => {
    test("matches the exact command and pattern tokens as a prefix", () => {
      const handler = command("npm install");
      expect(handler.commandNames).toEqual(["npm"]);
      expect(handler.matches("npm", ["install"])).toBe(true);
      expect(handler.matches("npm", ["install", "--save"])).toBe(true);
      expect(handler.matches("npm", ["run", "build"])).toBe(false);
      expect(handler.matches("pnpm", ["install"])).toBe(false);
    });

    test("a bare command name matches any args", () => {
      const handler = command("deploy");
      expect(handler.matches("deploy", [])).toBe(true);
      expect(handler.matches("deploy", ["--prod"])).toBe(true);
    });

    test("empty patterns throw", () => {
      expect(() => command("  ")).toThrow(/must not be empty/);
    });
  });

  describe("regex patterns", () => {
    test("matches the full command line", () => {
      const handler = command(/^git (pull|push)/);
      expect(handler.commandNames).toEqual(["git"]);
      expect(handler.matches("git", ["push", "origin"])).toBe(true);
      expect(handler.matches("git", ["status"])).toBe(false);
    });

    test("stateful (global) regexes match consistently across calls", () => {
      const handler = command(/npm install/g);
      expect(handler.matches("npm", ["install"])).toBe(true);
      expect(handler.matches("npm", ["install"])).toBe(true);
    });

    test("throws when the command name cannot be extracted", () => {
      expect(() => command(/(npm|pnpm) install/)).toThrow(/Cannot extract command name/);
    });
  });

  describe("responses", () => {
    test("defaults to an empty successful response", async () => {
      expect(await command("noop").resolve("noop", [], ctx)).toEqual({});
    });

    test("static responses are returned as-is", async () => {
      const handler = command("fail", { stderr: "boom", exitCode: 2 });
      expect(await handler.resolve("fail", [], ctx)).toEqual({ stderr: "boom", exitCode: 2 });
    });

    test("function responses receive args and context", async () => {
      const handler = command("echo-args", (args, { stdin }) => ({
        stdout: JSON.stringify({ args, stdin }),
      }));
      const result = await handler.resolve("echo-args", ["a"], { stdin: "in" });
      expect(JSON.parse(result.stdout!)).toEqual({ args: ["a"], stdin: "in" });
    });
  });
});

describe("handlersToCustomCommands", () => {
  test("groups handlers for the same command into one just-bash command", () => {
    const commands = handlersToCustomCommands([
      command("npm install"),
      command("npm run"),
      command("deploy"),
    ]);
    expect(commands.map((c) => c.name).sort()).toEqual(["deploy", "npm"]);
  });

  test("the first matching handler wins and defaults are filled in", async () => {
    const bash = new Bash({
      customCommands: handlersToCustomCommands([
        command("npm install", { stdout: "installed\n" }),
        command("npm", { stdout: "generic\n", exitCode: 1 }),
      ]),
    });
    expect(await bash.exec("npm install")).toMatchObject({
      stdout: "installed\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.exec("npm audit")).toMatchObject({ stdout: "generic\n", exitCode: 1 });
  });

  test("no matching pattern yields exit code 127", async () => {
    const bash = new Bash({
      customCommands: handlersToCustomCommands([command("npm install")]),
    });
    const result = await bash.exec("npm run build");
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain("no pattern matched");
  });

  test("handlers receive piped stdin as a string", async () => {
    const bash = new Bash({
      customCommands: handlersToCustomCommands([
        command("consume", (_args, { stdin }) => ({ stdout: `got:${stdin}` })),
      ]),
    });
    expect((await bash.exec("echo -n data | consume")).stdout).toBe("got:data");
  });
});
