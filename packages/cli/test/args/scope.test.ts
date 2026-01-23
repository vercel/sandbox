import { scope } from "../../src/args/scope.ts";
import { describe, test, expect, expectTypeOf, beforeEach } from "vitest";
import * as cmd from "cmd-ts";

describe("scope", () => {
  const command = cmd.command({
    name: "test",
    args: { scope },
    handler(args) {
      return args;
    },
  });

  beforeEach(() => {
    const env = { ...process.env };
    return () => {
      Object.assign(process.env, env);
      for (const key in process.env) {
        if (!(key in env)) {
          delete process.env[key];
        }
      }
    };
  });

  test("parses --scope=team --project=proj --token=123", async () => {
    const result = await cmd.run(command, [
      "--scope=team",
      "--project=proj",
      "--token=123",
    ]);
    expectTypeOf(result.scope).toEqualTypeOf<{
      team: string;
      project: string;
      token: string;
    }>();
    expect(result.scope).toEqual({
      team: "team",
      project: "proj",
      token: "123",
    });
  });

  test("infers token from env var", async () => {
    process.env.VERCEL_AUTH_TOKEN = "from-env";
    const result = await cmd.run(command, ["--scope=team", "--project=proj"]);
    expectTypeOf(result.scope).toEqualTypeOf<{
      team: string;
      project: string;
      token: string;
    }>();
    expect(result.scope).toEqual({
      team: "team",
      project: "proj",
      token: "from-env",
    });
  });
});
