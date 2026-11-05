import * as cmd from "cmd-ts";
import type { ArgParser, ParseContext } from "cmd-ts/dist/esm/argparser";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  parseConfig,
  type ManagedCredentialsConfig,
} from "../../src/util/managed-credentials-config";
import {
  captureRetryInvocation,
  renderManagedCredentialsRetryCommand,
  type RetryInvocation,
  type RetryArgument,
} from "../../src/util/managed-credentials-retry-command";

const proposal = (): ManagedCredentialsConfig => ({
  source: { type: "git", url: "https://github.com/acme/widgets.git" },
  credentials: {
    github: [
      {
        repositories: ["acme/widgets"],
        actions: [
          "github:issues:read",
          "github:pull-request:create",
          "git:write",
        ],
        actAs: "12345",
      },
    ],
  },
});

/** A configuration whose commit credit could only have been imported. */
const imported = (): ManagedCredentialsConfig => ({
  ...proposal(),
  commitAs: { name: "Jack O'Neil", email: "jack@example.com" },
});

function render(config = proposal(), invocation?: RetryInvocation) {
  return renderManagedCredentialsRetryCommand({
    config,
    team: "team_corrected",
    project: "prj_corrected",
    vcpus: 4,
    invocation,
  });
}

// Execute only a shell stub, never the real CLI. Fallback snippets create a
// temporary file only during replay; the real CLI readers consume that file
// and (when requested) network-policy stdin before the shell cleans it up.
const payloadReader = fileURLToPath(
  new URL("../../src/util/managed-credentials-payload.ts", import.meta.url),
);
const policyReader = fileURLToPath(
  new URL("../../src/args/network-policy.ts", import.meta.url),
);
const replayScript = `
const fs = require("node:fs");
// Only mktemp uses the test TMPDIR; keep tsx runtime caches outside that scope.
delete process.env.TMPDIR;
(async () => {
  const args = process.argv.slice(1);
  const configArg = args.find(arg => arg.startsWith("--credentials-github-from-config-file="));
  const configPath = configArg?.slice("--credentials-github-from-config-file=".length);
  let config, configMode, regularFile, networkPolicy;
  if (configPath && configPath !== "-") {
    require("tsx/cjs");
    const { readJsonPayload } = require(process.env.SANDBOX_RETRY_PAYLOAD_READER);
    config = await readJsonPayload(configPath, "--credentials-github-from-config-file");
    const stat = fs.statSync(configPath);
    configMode = stat.mode & 511;
    regularFile = stat.isFile();
  }
  let input = "";
  if (args.includes("--network-policy-file=-")) {
    require("tsx/cjs");
    const { readNetworkPolicyFile } = require(process.env.SANDBOX_RETRY_POLICY_READER);
    networkPolicy = await readNetworkPolicyFile("-");
  } else input = fs.readFileSync(0, "utf8");
  process.stdout.write(JSON.stringify({ args, input, config, configPath, configMode, regularFile, networkPolicy }));
  process.exitCode = Number(process.env.SANDBOX_RETRY_TEST_EXIT || 0);
})().catch(error => { console.error(error); process.exitCode = 1; });`;

function replay(
  command: string,
  env: Record<string, string> = {},
  shell = "/bin/bash",
  input = "",
  exitCode = 0,
) {
  const result = spawnSync(
    shell,
    [
      "-c",
      `sandbox() { node -e '${replayScript}' -- "$@"; }
vercel() { sandbox "$@"; }
${command}`,
    ],
    {
      encoding: "utf8",
      input,
      env: {
        PATH: process.env.PATH,
        SANDBOX_RETRY_PAYLOAD_READER: payloadReader,
        SANDBOX_RETRY_POLICY_READER: policyReader,
        ...env,
      },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(exitCode);
  const output = JSON.parse(result.stdout) as {
    args: string[];
    input: string;
    config?: ManagedCredentialsConfig;
    configPath?: string;
    configMode?: number;
    regularFile?: boolean;
    networkPolicy?: unknown;
  };
  if (output.configPath && output.configPath !== "-")
    expect(existsSync(output.configPath)).toBe(false);
  return output;
}

async function capture(
  argv: string[],
  options: {
    root?: string;
    command?: RetryInvocation["command"];
    nested?: boolean;
    register?: ArgParser<unknown>["register"];
  } = {},
) {
  const captureParser: ArgParser<RetryInvocation> = {
    register(registration) {
      options.register?.(registration);
      for (const key of ["yes", "rm", "json", "enable-github-credentials"])
        registration.forceFlagLongNames.add(key);
      for (const key of ["y", "i", "t"])
        registration.forceFlagShortNames.add(key);
      for (const key of ["name", "env", "token", "scope", "vcpus"])
        registration.forceOptionLongNames.add(key);
      registration.forceOptionShortNames.add("e");
    },
    async parse(context) {
      // Already-visited options and positionals are still invocation inputs.
      for (const node of context.nodes) context.visitedNodes.add(node);
      return { _tag: "ok", value: captureRetryInvocation(context) };
    },
  };
  const leaf = cmd.command({
    name: options.command ?? "create",
    args: { invocation: captureParser },
    handler: ({ invocation }) => invocation,
  });
  const root = cmd.subcommands({
    name: options.root ?? "sandbox",
    cmds: { [options.command ?? "create"]: leaf },
  });
  const parser = options.nested ? root : leaf;
  const parsed = await cmd.parse(parser, argv);
  expect(parsed._tag).toBe("ok");
  if (parsed._tag !== "ok") throw new Error("Fixture parse failed");
  const value = parsed.value as
    | { invocation: RetryInvocation }
    | { args: { invocation: RetryInvocation } };
  return "invocation" in value ? value.invocation : value.args.invocation;
}

async function actualCommand(command: RetryInvocation["command"]) {
  if (command === "create")
    return (await import("../../src/commands/create")).create;
  if (command === "sh") return (await import("../../src/commands/sh")).sh;
  return (await import("../../src/commands/run")).run;
}

/** Build the parsed unit cmd-ts produces for `spec`, inline or split. */
function flag(spec: string, value?: string): RetryArgument {
  const dash = spec.startsWith("--") ? "--" : "-";
  const rest = spec.slice(dash.length);
  const equals = rest.indexOf("=");
  if (equals !== -1)
    return {
      kind: "option",
      dash,
      keys: rest.slice(0, equals),
      value: rest.slice(equals + 1),
      inline: true,
    };
  return value === undefined
    ? { kind: "option", dash, keys: rest }
    : { kind: "option", dash, keys: rest, value };
}
const pos = (raw: string): RetryArgument => ({ kind: "positional", raw });
const sep: RetryArgument = { kind: "separator" };

/** Flatten captured units back to argv text, for comparing against an input. */
function flat(args: readonly RetryArgument[]): string[] {
  return args.flatMap((arg) =>
    arg.kind === "separator"
      ? ["--"]
      : arg.kind === "positional"
        ? [arg.raw]
        : arg.value === undefined
          ? [`${arg.dash}${arg.keys}`]
          : arg.inline
            ? [`${arg.dash}${arg.keys}=${arg.value}`]
            : [`${arg.dash}${arg.keys}`, arg.value],
  );
}

describe("captureRetryInvocation", () => {
  test.each(["create", "sh", "run"] as const)(
    "retains every non-replaced long option value using real %s registration",
    async (command) => {
      const actual = await actualCommand(command);
      const registration = {
        forceFlagLongNames: new Set<string>(),
        forceFlagShortNames: new Set<string>(),
        forceOptionLongNames: new Set<string>(),
        forceOptionShortNames: new Set<string>(),
      };
      actual.register(registration);
      const replaced = new Set([
        "scope",
        "team",
        "project",
        "vcpus",
        "token",
        "env",
        "request-header",
      ]);
      const flags = [...registration.forceOptionLongNames].filter(
        (key) => !replaced.has(key) && !key.startsWith("credentials-github-"),
      );
      const argv = flags.flatMap((key, i) => [
        `--${key}`,
        `--credentials-github-repo=value-${i}`,
      ]);
      const invocation = await capture([command, ...argv], {
        command,
        nested: true,
        register: actual.register,
      });
      expect(
        replay(render(proposal(), invocation)).args.slice(-argv.length),
      ).toEqual(argv);
    },
  );

  test.each(["create", "sh", "run"] as const)(
    "retains -t tag values and consent clusters using real %s registration",
    async (command) => {
      const actual = await actualCommand(command);
      const { args: createArgs } = await import("../../src/commands/create");
      for (const alias of ["-t", "-yt"]) {
        const invocation = await capture(
          [command, alias, "--scope=tag-value"],
          { command, nested: true, register: actual.register },
        );
        const args = replay(render(proposal(), invocation)).args;
        expect(args.slice(-2)).toEqual(["-t", "--scope=tag-value"]);
        const parsed = await cmd.parse(
          cmd.command({
            name: command,
            args: { tags: createArgs.tags },
            handler: (value) => value,
          }),
          args.slice(-2),
        );
        expect(parsed).toEqual({
          _tag: "ok",
          value: { tags: { "--scope": "tag-value" } },
        });
      }
    },
  );

  test("preserves child node -e/code literally without environment replacements", async () => {
    const child = [
      "--",
      "node",
      "-e",
      "console.log(1)",
      "-e=literal",
      "--scope=child",
    ];
    const invocation = await capture(["run", ...child], {
      command: "run",
      nested: true,
    });
    const command = render(proposal(), invocation);
    expect(command).not.toContain("SANDBOX_RETRY_ENV_");
    expect(replay(command).args.slice(-child.length)).toEqual(child);
  });
  test("defaults without a command path, without reading process.argv", () => {
    const context: ParseContext = { nodes: [], visitedNodes: new Set() };
    expect(captureRetryInvocation(context)).toEqual({
      appName: "sandbox",
      command: "create",
      args: [],
    });
  });

  test.each(["sandbox", "vercel sandbox"])(
    "captures %s run AST values, visited positionals and sentinel",
    async (root) => {
      const input = [
        "run",
        "--name",
        "two words",
        "--env=A=secret=value",
        "-ity",
        "--",
        "node",
        "-e",
        "console.log('$HOME')",
        "--yes",
        "--scope=child",
      ];
      const result = await capture(input, {
        root,
        command: "run",
        nested: true,
      });
      expect(result.appName).toBe(root);
      expect(result.command).toBe("run");
      const replayed = replay(render(proposal(), result), {
        SANDBOX_RETRY_ENV_1: "A=restored",
      });
      expect(flat(result.args).slice(-6)).toEqual([
        "--",
        "node",
        "-e",
        "console.log('$HOME')",
        "--yes",
        "--scope=child",
      ]);
      expect(replayed.args.slice(-6)).toEqual(flat(result.args).slice(-6));
      expect(replayed.args).toContain("-i");
      expect(replayed.args).toContain("-t");
      expect(replayed.args).not.toContain("-y");
      expect(replayed.args).toContain("--name");
      expect(replayed.args).toContain("two words");
      expect(JSON.stringify(result)).toContain("secret=value");
    },
  );

  test.each(["create", "run", "sh"] as const)(
    "uses actual %s path and preserves equal-named positionals",
    async (command) => {
      const result = await capture([command, command, "--", command], {
        command,
        nested: true,
      });
      expect(result.appName).toBe("sandbox");
      expect(result.command).toBe(command);
      expect(flat(result.args)).toEqual([command, "--", command]);
    },
  );

  test("preserves raw child short-option clusters when run has no sentinel", async () => {
    const result = await capture(["run", "node", "-long", "--other=value"], {
      command: "run",
      nested: true,
    });
    expect(flat(result.args)).toEqual(["node", "-long", "--other=value"]);
    expect(replay(render(proposal(), result)).args.slice(-3)).toEqual(
      flat(result.args),
    );
  });

  test("preserves empty positional nodes if supplied by the parser", () => {
    const context: ParseContext = {
      nodes: [{ type: "positionalArgument", index: 0, raw: "" }],
      visitedNodes: new Set(),
    };
    expect(flat(captureRetryInvocation(context).args)).toEqual([""]);
  });

  test("preserves split short option values and equals-valued options", async () => {
    expect(
      flat((await capture(["-e", "A=x y", "--name=a=b", "opencode"])).args),
    ).toEqual(["-e", "A=x y", "--name=a=b", "opencode"]);
  });
});

describe("renderManagedCredentialsRetryCommand", () => {
  test.each(["split", "equals"])(
    "redacts repeated %s request-header values and round-trips the actual parser",
    async (form) => {
      const { parseRequestHeader } = await import(
        "../../src/args/network-policy"
      );
      const header =
        "registry.npmjs.org:Authorization=Bearer header-secret:$()=padding";
      const second = "api.example.com:X-Token=another-header-secret";
      const args = [header, second].map((value) =>
        form === "split"
          ? flag("--request-header", value)
          : flag(`--request-header=${value}`),
      );
      const command = render(proposal(), {
        appName: "sandbox",
        command: "create",
        args,
      });
      expect(command).not.toContain("header-secret");
      expect(command).toContain("${SANDBOX_RETRY_HEADER_1:?");
      expect(command).toContain("${SANDBOX_RETRY_HEADER_2:?");
      const replayed = replay(command, {
        SANDBOX_RETRY_HEADER_1: header,
        SANDBOX_RETRY_HEADER_2: second,
      });
      const recovered = replayed.args
        .filter((arg) => arg.startsWith("--request-header="))
        .map((arg) =>
          parseRequestHeader(arg.slice("--request-header=".length)),
        );
      expect(recovered.map((value) => value.value.reveal())).toEqual([
        parseRequestHeader(header).value.reveal(),
        parseRequestHeader(second).value.reveal(),
      ]);
      expect(recovered.map(({ domain, name }) => ({ domain, name }))).toEqual([
        { domain: "registry.npmjs.org", name: "authorization" },
        { domain: "api.example.com", name: "x-token" },
      ]);
      const missing = spawnSync(
        "/bin/bash",
        ["-c", `sandbox() { printf SHOULD_NOT_RUN; }; ${command}`],
        { encoding: "utf8", env: { PATH: process.env.PATH } },
      );
      expect(missing.status).not.toBe(0);
      expect(missing.stdout).toBe("");
      expect(missing.stderr).toContain("SANDBOX_RETRY_HEADER_1");
    },
  );

  test.each(["/bin/bash", "/bin/zsh"].filter((shell) => existsSync(shell)))(
    "fallback uses a private regular file and preserves network-policy stdin in %s",
    (shell) => {
      const config = proposal();
      config.source!.revision = "refs/heads/review";
      const command = render(config, {
        appName: "sandbox",
        command: "run",
        args: [
          flag("--network-policy-file=-"),
          flag("--interactive"),
          sep,
          pos("node"),
          pos("-e"),
          pos("console.log(1)"),
        ],
      });
      expect(command).not.toContain("--credentials-github-from-config-file=-");
      const policy = { allow: ["example.com"] };
      const replayed = replay(command, {}, shell, JSON.stringify(policy));
      expect(replayed.config).toEqual(config);
      expect(replayed.regularFile).toBe(true);
      expect(replayed.configMode).toBe(0o600);
      expect(replayed.networkPolicy).toEqual(policy);
      expect(replayed.args.slice(-6)).toEqual([
        "--network-policy-file=-",
        "--interactive",
        "--",
        "node",
        "-e",
        "console.log(1)",
      ]);
      expect(command).not.toContain("--yes");
    },
  );

  test.each(["/bin/bash", "/bin/zsh"].filter((shell) => existsSync(shell)))(
    "fallback leaves sh/run input available and cleans up even on CLI failure in %s",
    (shell) => {
      const directory = mkdtempSync(join(tmpdir(), "sandbox-retry-'-$()-"));
      try {
        const config = proposal();
        config.source!.depth = 2;
        const before = readdirSync(directory);
        for (const command of ["sh", "run"] as const) {
          const snippet = render(config, {
            appName: "sandbox",
            command,
            args:
              command === "run"
                ? [flag("--interactive"), sep, pos("echo"), pos("hi")]
                : [],
          });
          // Rendering itself must not run mktemp, write the file, or touch stdin.
          expect(readdirSync(directory)).toEqual(before);
          const replayed = replay(
            snippet,
            { TMPDIR: directory, SANDBOX_RETRY_TEST_EXIT: "7" },
            shell,
            "interactive input\n",
            7,
          );
          expect(replayed.config).toEqual(config);
          expect(replayed.input).toBe("interactive input\n");
          expect(replayed.configMode).toBe(0o600);
          expect(readdirSync(directory)).toEqual(before);
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
  test("renders a fully explicit inferred proposal and exact API actions, with no consent", () => {
    const command = render();
    const { args, input } = replay(command);
    expect(args).toEqual([
      "create",
      "--scope=team_corrected",
      "--project=prj_corrected",
      "--vcpus=4",
      "--credentials-github-repo=acme/widgets",
      "--credentials-github-action=github:issues:read",
      "--credentials-github-action=github:pull-request:create",
      "--credentials-github-action=git:write",
      "--credentials-github-act-as=12345",
    ]);
    expect(input).toBe("");
    expect(command).not.toContain("--yes");
    expect(command).not.toContain("github:issues:comment");
  });

  test("imported commit credit has no flag, so it replays as exact JSON", () => {
    const config = imported();
    const replayed = replay(render(config));
    expect(replayed.args).not.toContain(
      "--credentials-github-commit-as=Jack O'Neil <jack@example.com>",
    );
    expect(replayed.config).toEqual(config);
  });

  test.each(
    [false, true].flatMap((apiOnly) =>
      ["12345", "@scubbo", "@Scubbo_Review"].map((actAs) => ({
        apiOnly,
        actAs,
      })),
    ),
  )(
    "recovery preserves configuration without inference (API-only=$apiOnly, actor=$actAs)",
    async ({ apiOnly, actAs }) => {
      const { managedCredentialOptions } = await import(
        "../../src/args/managed-credentials"
      );
      const { resolveManagedCredentials } = await import(
        "../../src/util/managed-credentials-resolve"
      );
      const config = proposal();
      config.credentials.github[0].actAs = actAs;
      if (apiOnly) {
        config.credentials.github[0].actions = ["github:issues:read"];
      }
      const replayed = replay(render(config));
      expect(replayed.input).toBe("");
      if (apiOnly) {
        expect(replayed.args).not.toContain(
          "--credentials-github-action=git:write",
        );
        expect(replayed.args).not.toContain("--credentials-github-no-write");
        expect(
          replayed.args.some((arg) =>
            arg.startsWith("--credentials-github-commit-as"),
          ),
        ).toBe(false);
      }
      expect(replayed.args).toContain(`--credentials-github-act-as=${actAs}`);
      expect(replayed.args).not.toContain(
        "--credentials-github-from-config-file=-",
      );
      const args = replayed.args.filter((arg) =>
        arg.startsWith("--credentials-github-"),
      );
      const parser = cmd.command({
        name: "create",
        args: managedCredentialOptions,
        handler: (value) => value,
      });
      const parsed = await cmd.parse(parser, args);
      expect(parsed._tag).toBe("ok");
      if (parsed._tag !== "ok") throw new Error("Explicit flags did not parse");
      const resolved = await resolveManagedCredentials(parsed.value, {
        token: "unused",
        teamId: "team_corrected",
        inferRepositoryImpl: async () => {
          throw new Error("Repository must not be inferred");
        },
        inferActorImpl: async ({ explicit }) => {
          expect(explicit).toBe(actAs);
          return { actAs: explicit!, source: "explicit" };
        },
      });
      expect(resolved?.config).toEqual(config);
    },
  );

  test("grouped API-only access falls back to exact canonical JSON without write or commit credit", () => {
    const config = proposal();
    config.credentials.github[0].repositories.push("acme/reference");
    config.credentials.github[0].actions = ["github:issues:read"];
    const { args, config: replayed } = replay(render(config));
    expect(replayed).toEqual(config);
    expect(parseConfig(replayed)).toEqual(config);
    expect(args).not.toContain("--credentials-github-no-write");
    expect(replayed?.credentials.github[0]).toEqual({
      repositories: ["acme/widgets", "acme/reference"],
      actions: ["github:issues:read"],
      actAs: "12345",
    });
    expect(replayed).not.toHaveProperty("commitAs");
    expect(
      args.some((arg) => arg.startsWith("--credentials-github-commit-as")),
    ).toBe(false);
    expect(args).not.toContain("--credentials-github-from-config-file=-");
  });

  test("unsupported logical-read actions are rejected rather than replayed as write access", () => {
    expect(() =>
      parseConfig({
        ...proposal(),
        credentials: {
          github: [{ repositories: ["acme/widgets"], actions: ["git:read"] }],
        },
      }),
    ).toThrow(/Invalid managed credentials configuration/);
  });

  test("replaces old managed/context flags, preserves unrelated flags and positional delimiters", () => {
    const invocation: RetryInvocation = {
      appName: "vercel sandbox",
      command: "run",
      args: [
        flag("--enable-github-credentials"),
        flag("--scope", "old-team"),
        flag("--team=alias"),
        flag("--project=old-project"),
        flag("--vcpus", "1"),
        flag("--credentials-github-repo=old/repo"),
        flag("--credentials-github-action", "issues:comment"),
        flag("--credentials-github-act-as=999"),
        flag("--credentials-github-commit-as", "Old <old@example.com>"),
        flag("--credentials-github-no-write=false"),
        flag("--credentials-github-from-config-file", "mutable.json"),
        flag("--credentials-github-from-sandbox=sbx_old"),
        flag("--credentials-github-persist-configuration=out.json"),
        flag("--yes"),
        flag("-iy"),
        flag("--yes=false"),
        flag("--name", "keep name"),
        flag("--timeout=5m"),
        flag("--publish-port=3000"),
        flag("--rm"),
        flag("--json"),
        sep,
        pos("echo"),
        pos("--yes"),
        pos("--scope=child"),
        pos("--credentials-github-action=child"),
      ],
    };
    const before = structuredClone(invocation);
    const command = render(proposal(), invocation);
    const { args } = replay(command);
    expect(command.startsWith("vercel sandbox run ")).toBe(true);
    expect(args.slice(-5)).toEqual([
      "--",
      "echo",
      "--yes",
      "--scope=child",
      "--credentials-github-action=child",
    ]);
    expect(args).toContain(
      "--credentials-github-persist-configuration=out.json",
    );
    expect(args).toContain("-i");
    expect(args).toContain("keep name");
    expect(args).toContain("--timeout=5m");
    expect(args).toContain("--publish-port=3000");
    expect(args).toContain("--rm");
    expect(args).toContain("--json");
    for (const old of [
      "old-team",
      "alias",
      "old-project",
      "mutable.json",
      "sbx_old",
      "old/repo",
      "999",
      "-y",
    ])
      expect(args).not.toContain(old);
    expect(invocation).toEqual(before);
  });

  test.each(["/bin/bash", "/bin/zsh"].filter((shell) => existsSync(shell)))(
    "quotes apostrophes, substitution, newline and controls in %s",
    (shell) => {
      const values = [
        "O'Neil",
        "$HOME ${USER} $(printf INJECTED >&2) `printf BAD >&2`",
        "line\nend\n",
        "\u001b[31m\r\b\u0007\u007f\u009b\u202e",
        "",
        "a; printf BAD >&2",
      ];
      const command = render(proposal(), {
        appName: "sandbox",
        command: "run",
        args: [sep, pos("printf"), ...values.map(pos)],
      });
      expect(command).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202e]/);
      expect(replay(command, {}, shell).args.slice(-values.length)).toEqual(
        values,
      );
    },
  );

  test("keeps arbitrary child arguments intact rather than splitting short-option-looking positionals", () => {
    const child = [
      "--",
      "tool",
      "-123",
      "-yes",
      "-abc=x",
      "--",
      "",
      "--credentials-github-no-write",
    ];
    expect(
      replay(
        render(proposal(), {
          appName: "sandbox",
          command: "run",
          args: [sep, ...child.slice(1).map(pos)],
        }),
      ).args.slice(-child.length),
    ).toEqual(child);
  });

  test.each([
    ["--workdir", "--scope=directory-name"],
    ["--mount", "--credentials-github-repo=drive:/data"],
    ["--name", "--yes"],
    ["--tag", "--credentials-github-action=tag-value"],
  ])(
    "keeps the option-looking value attached to the actual CLI option %s",
    (option, value) => {
      const invocation: RetryInvocation = {
        appName: "sandbox",
        command: "run",
        args: [
          flag(option, value),
          flag("--scope=old-team"),
          flag("--vcpus=1"),
          sep,
          pos("echo"),
          pos("done"),
        ],
      };
      const args = replay(render(proposal(), invocation)).args;
      expect(args.slice(-5)).toEqual([option, value, "--", "echo", "done"]);
      expect(args).not.toContain("--scope=old-team");
      expect(args).not.toContain("--vcpus=1");
    },
  );

  test("preserves option-looking values of unrelated long and short options", () => {
    const invocation: RetryInvocation = {
      appName: "sandbox",
      command: "create",
      args: [
        flag("--name", "--yes"),
        flag("-w", "--env=not-an-env-option"),
        pos("opencode"),
      ],
    };
    const args = replay(render(proposal(), invocation)).args;
    expect(args.slice(-5)).toEqual(flat(invocation.args));
  });

  test("numbers child token placeholders consecutively across other redactions", () => {
    const command = render(proposal(), {
      appName: "sandbox",
      command: "run",
      args: [
        sep,
        pos("child"),
        flag("--token=first-child-secret"),
        flag("--env=A=between-secret"),
        flag("--request-header=example.com:X=between-header"),
        flag("--token", "second-child-secret"),
      ],
    });
    for (const secret of [
      "first-child-secret",
      "between-secret",
      "between-header",
      "second-child-secret",
    ])
      expect(command).not.toContain(secret);
    expect(command).toContain("${SANDBOX_RETRY_TOKEN_1:?");
    expect(command).toContain("${SANDBOX_RETRY_TOKEN_2:?");
    expect(command).not.toContain("SANDBOX_RETRY_TOKEN_3");
    const { args } = replay(command, {
      SANDBOX_RETRY_TOKEN_1: "first",
      SANDBOX_RETRY_TOKEN_2: "second",
      SANDBOX_RETRY_ENV_1: "A=env",
      SANDBOX_RETRY_HEADER_1: "example.com:X=header",
    });
    expect(args.slice(-5)).toEqual([
      "--token=first",
      "--env=A=env",
      "--request-header=example.com:X=header",
      "--token",
      "second",
    ]);
  });

  test("hides explicit token/env values and requires replacements, including short and child flags", () => {
    const command = render(proposal(), {
      appName: "sandbox",
      command: "run",
      args: [
        flag("--token", "auth-secret"),
        flag("--env=A=env-secret"),
        flag("-ye", "B=short-secret"),
        flag("--env", "C"),
        sep,
        pos("child"),
        flag("--token=child-secret"),
        flag("--env=D=child-env"),
      ],
    });
    for (const secret of [
      "auth-secret",
      "env-secret",
      "short-secret",
      "child-secret",
      "child-env",
    ])
      expect(command).not.toContain(secret);
    expect(command).toContain(
      '--token="${VERCEL_AUTH_TOKEN:?Set VERCEL_AUTH_TOKEN}"',
    );
    const env = {
      VERCEL_AUTH_TOKEN: "replacement '$() token",
      SANDBOX_RETRY_TOKEN_1: "different child identity",
      SANDBOX_RETRY_ENV_1: "A=replacement 1",
      SANDBOX_RETRY_ENV_2: "B=replacement 2",
      SANDBOX_RETRY_ENV_3: "C=replacement 3",
      SANDBOX_RETRY_ENV_4: "D=replacement 4",
    };
    const { args } = replay(command, env);
    expect(args).toContain("--token=replacement '$() token");
    expect(args).toContain("--token=different child identity");
    expect(command).toContain("${SANDBOX_RETRY_ENV_1:?");
    for (const i of [1, 3, 4])
      expect(args).toContain(
        `--env=${env[`SANDBOX_RETRY_ENV_${i}` as keyof typeof env]}`,
      );
    expect(args).toContain("-e");
    expect(args).toContain(env.SANDBOX_RETRY_ENV_2);
    const missing = spawnSync(
      "/bin/bash",
      ["-c", `sandbox() { printf SHOULD_NOT_RUN; }; ${command}`],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH },
      },
    );
    expect(missing.status).not.toBe(0);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("Set VERCEL_AUTH_TOKEN");
  });

  const complex: [string, (config: ManagedCredentialsConfig) => void][] = [
    [
      "multiple repositories",
      (c) =>
        c.credentials.github.push({
          repositories: ["acme/other"],
          actions: ["github:issues:read"],
          actAs: "9",
        }),
    ],
    [
      "no clone source",
      (c) => {
        delete c.source;
      },
    ],
    [
      "different source repository",
      (c) => {
        c.source = { type: "git", url: "https://github.com/acme/other.git" };
      },
    ],
    [
      "source revision",
      (c) => {
        c.source!.revision = "refs/heads/$topic";
      },
    ],
    [
      "source depth",
      (c) => {
        c.source!.depth = 3;
      },
    ],
    [
      "inert commit identity",
      (c) => {
        c.credentials.github[0].actions = ["github:issues:read"];
      },
    ],
    [
      "zero API actions",
      (c) => {
        c.credentials.github[0].actions = ["git:write"];
      },
    ],
    [
      "empty rights",
      (c) => {
        c.credentials.github[0].actions = [];
      },
    ],
    [
      "empty groups",
      (c) => {
        c.credentials.github = [];
      },
    ],
    [
      "no git permission",
      (c) => {
        c.credentials.github[0].actions = ["github:issues:read"];
      },
    ],
    [
      "both git permissions",
      (c) => {
        c.credentials.github[0].actions.push("git:write-workflows");
      },
    ],
    [
      "unresolved actor",
      (c) => {
        delete c.credentials.github[0].actAs;
      },
    ],
    [
      "empty actor",
      (c) => {
        c.credentials.github[0].actAs = "";
      },
    ],
    [
      "imported commit credit",
      (c) => {
        c.commitAs = { name: " Jack ", email: "jack@example.com" };
      },
    ],
  ];

  test.each(complex)(
    "replays %s without a mutable Sandbox selector or permission changes",
    (_name, change) => {
      const config = proposal();
      change(config);
      const before = structuredClone(config);
      const command = render(config, {
        appName: "sandbox",
        command: "sh",
        args: [
          flag("--credentials-github-from-sandbox=sbx_mutable"),
          flag("--yes"),
          flag("--rm"),
        ],
      });
      const replayed = replay(command);
      if (
        [
          "zero API actions",
          "no git permission",
          "inert commit identity",
          "both git permissions",
        ].includes(_name)
      ) {
        expect(replayed.config).toBeUndefined();
        for (const action of config.credentials.github[0].actions)
          expect(replayed.args).toContain(
            `--credentials-github-action=${action}`,
          );
        expect(replayed.args).toContain(
          `--credentials-github-act-as=${config.credentials.github[0].actAs}`,
        );
        expect(command).not.toContain("sbx_mutable");
        expect(command).not.toContain("--yes");
        expect(config).toEqual(before);
        return;
      }
      expect(replayed.args).toEqual([
        "sh",
        "--scope=team_corrected",
        "--project=prj_corrected",
        "--vcpus=4",
        `--credentials-github-from-config-file=${replayed.configPath}`,
        "--rm",
      ]);
      expect(replayed.config).toEqual(config);
      // Malformed in-memory values may be rendered losslessly for recovery,
      // but a config-file replay must still fail canonical validation.
      if (["empty rights", "empty actor"].includes(_name)) {
        expect(() => parseConfig(replayed.config)).toThrow(
          /Invalid managed credentials configuration/,
        );
      } else {
        expect(parseConfig(replayed.config)).toEqual(config);
      }
      expect(replayed.regularFile).toBe(true);
      expect(replayed.configMode).toBe(0o600);
      expect(replayed.input).toBe("");
      expect(command).not.toContain("sbx_mutable");
      expect(command).not.toContain("--credentials-github-action");
      expect(command).not.toContain("--yes");
      expect(config).toEqual(before);
    },
  );

  test("heredoc cannot expand shell syntax, leak controls, or collide with payload text", () => {
    const config = proposal();
    config.source!.revision =
      "SANDBOX_MANAGED_CREDENTIALS\nSANDBOX_MANAGED_CREDENTIALS_\n$(printf INJECTED >&2)";
    config.commitAs = {
      name: "O'Neil\n\u001b[31m\u009b\u202e",
      email: "jack@example.com",
    };
    const command = render(config);
    const marker = /<<'([^']+)'/.exec(command)?.[1];
    expect(marker).toBeTruthy();
    expect(JSON.stringify(config)).not.toContain(marker);
    expect(command).not.toMatch(/[\u001b\u007f-\u009f\u202e]/);
    expect(replay(command).config).toEqual(config);
  });
});
