import { describe, expect, test } from "vitest";
import * as cmd from "cmd-ts";
import {
  parseConfig,
  serializeConfig,
} from "../../src/util/managed-credentials-config";
import { managedCredentialOptions } from "../../src/args/managed-credentials";
import { toTransport } from "../../src/util/managed-credentials-transport";
import { toConfig } from "../../src/util/managed-credentials-reuse";
import { renderManagedCredentialsRetryCommand } from "../../src/util/managed-credentials-retry-command";

const parser = cmd.command({
  name: "credentials",
  args: managedCredentialOptions,
  handler: (args) => args,
});

describe("npm credentials", () => {
  test("the bare flag enables npm and omission leaves it absent", async () => {
    expect((await cmd.run(parser, ["--npm-credentials"])).npmCredentials).toBe(
      true,
    );
    expect((await cmd.run(parser, [])).npmCredentials).toBeUndefined();
    expect(
      (await cmd.runSafely(parser, ["--npm-credentials", "true"]))._tag,
    ).toBe("error");
  });

  test.each([false, "true", {}, "npm_example"])(
    "rejects unsupported npm config %j",
    (npm) => {
      expect(() => parseConfig({ credentials: { npm } })).toThrow();
    },
  );

  test("preserves npm-only access across file, transport and session metadata", () => {
    const config = parseConfig({ credentials: { npm: true } });
    expect(parseConfig(JSON.parse(serializeConfig(config)))).toEqual(config);
    const transport = toTransport(config);
    expect(transport).toEqual({ credentials: { npm: true } });
    expect(parseConfig(toConfig(transport, "example"))).toEqual(config);
  });

  test("preserves combined npm and GitHub access", () => {
    const config = parseConfig({
      credentials: {
        npm: true,
        github: [
          { repo: "acme/widgets", actions: ["issues:read"], actAs: "123" },
        ],
      },
    });
    const transport = toTransport(config);
    expect(transport.credentials).toEqual({
      npm: true,
      github: [
        {
          repositories: ["acme/widgets"],
          actions: ["github:issues:read"],
          actAs: "123",
        },
      ],
    });
    expect(parseConfig(toConfig(transport, "example"))).toEqual(config);
  });

  test("prints exactly one npm flag on retry without Git flags or resource overrides", () => {
    const command = renderManagedCredentialsRetryCommand({
      config: parseConfig({ credentials: { npm: true } }),
      team: "team",
      project: "project",
      invocation: {
        appName: "sandbox",
        command: "create",
        args: ["--npm-credentials", "--yes"],
      },
    });
    expect(command).toBe(
      "sandbox create --scope=team --project=project --npm-credentials",
    );
  });

  test("keeps npm on combined explicit-flags retries", () => {
    const config = parseConfig({
      source: { repo: "acme/widgets" },
      credentials: {
        npm: true,
        github: [
          {
            repo: "acme/widgets",
            actions: ["git:read", "issues:read"],
            actAs: "123",
          },
        ],
      },
    });
    const command = renderManagedCredentialsRetryCommand({
      config,
      team: "team",
      project: "project",
      vcpus: 6,
    });
    expect(command).toContain("--npm-credentials");
    expect(command).toContain("--credentials-no-write");
  });
});
