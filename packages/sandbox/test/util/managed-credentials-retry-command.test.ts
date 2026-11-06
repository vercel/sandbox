import * as cmd from "cmd-ts";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { expect, test } from "vitest";
import { managedCredentialOptions } from "../../src/args/managed-credentials";
import { type ManagedCredentialsConfig } from "../../src/util/managed-credentials-config";
import { resolveManagedCredentials } from "../../src/util/managed-credentials-resolve";
import { renderManagedCredentialsRetryCommand } from "../../src/util/managed-credentials-retry-command";

const proposal = (): ManagedCredentialsConfig => ({
  source: { type: "git", url: "https://github.com/acme/widgets.git" },
  credentials: {
    github: [
      {
        repositories: ["acme/widgets"],
        actions: ["github:issues:read", "git:write"],
        actAs: "12345",
      },
    ],
  },
});
function render(
  config = proposal(),
  extra: Partial<
    Parameters<typeof renderManagedCredentialsRetryCommand>[0]
  > = {},
) {
  return renderManagedCredentialsRetryCommand({
    config,
    team: "team_selected",
    project: "prj_selected",
    vcpus: 6,
    ...extra,
  });
}

// Execute a shell stub, never the real CLI, and leave stdin for approval.
const stub = `process.stdout.write(JSON.stringify({
args: process.argv.slice(1), input: require("node:fs").readFileSync(0, "utf8") }));`;
const shells = ["/bin/bash", "/bin/zsh"].filter(existsSync);
function replay(
  command: string | undefined,
  shell = "/bin/bash",
  env: Record<string, string> = {},
) {
  if (command === undefined)
    throw new Error("Expected a direct recovery command");
  const result = spawnSync(
    shell,
    [
      "-c",
      `sandbox() { node -e '${stub}' -- "$@"; }
vercel() { sandbox "$@"; }
${command}`,
    ],
    {
      encoding: "utf8",
      input: "approval input\n",
      env: { PATH: process.env.PATH, ...env },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const output = JSON.parse(result.stdout) as { args: string[]; input: string };
  expect(output.input).toBe("approval input\n");
  return output;
}

test.each(["sandbox", "vercel sandbox"] as const)(
  "prints only resolved credentials and scope through %s",
  (appName) => {
    const command = render(undefined, { appName });
    const args = replay(command).args;
    expect(args).toEqual([
      ...(appName === "vercel sandbox" ? ["sandbox"] : []),
      "create",
      "--scope=team_selected",
      "--project=prj_selected",
      "--vcpus=6",
      "--credentials-github-repo=acme/widgets",
      "--credentials-github-action=github:issues:read",
      "--credentials-github-action=git:write",
      "--credentials-github-act-as=12345",
    ]);
    expect(command).not.toContain("--yes");
  },
);

test("prints the matching username without mutating the numeric actor request", () => {
  const config = proposal();
  const before = structuredClone(config);
  const command = render(config, {
    actor: { actAs: "12345", login: "scubbo" },
  });
  expect(replay(command).args).toContain("--credentials-github-act-as=@scubbo");
  expect(command).not.toContain("--credentials-github-act-as=12345");
  expect(config).toEqual(before);
});

test.each([
  undefined,
  { actAs: "other-id", login: "another-account" },
  { actAs: "12345", login: " padded " },
  { actAs: "12345", login: "unsafe\nname" },
])(
  "keeps the ID when username metadata is unavailable or unsafe: %j",
  (actor) => {
    expect(replay(render(undefined, { actor })).args).toContain(
      "--credentials-github-act-as=12345",
    );
  },
);

test("keeps an existing username instead of substituting display metadata", () => {
  const config = proposal();
  config.credentials.github[0].actAs = "@chosen";
  const command = render(config, {
    actor: { actAs: "@chosen", login: "another-account" },
  });
  expect(replay(command).args).toContain("--credentials-github-act-as=@chosen");
});

test("distinguishes a numeric username from a user ID", () => {
  const command = render(undefined, {
    actor: { actAs: "12345", login: "67890" },
  });
  expect(replay(command).args).toContain("--credentials-github-act-as=@67890");
});

test.each([
  ["12345", ["github:issues:read", "git:write"]],
  ["@Scubbo_Review", ["github:issues:read"]],
  ["@scubbo", ["git:write", "git:write-workflows"]],
] as const)(
  "round-trips explicit actions and actor %s without inference",
  async (actAs, actions) => {
    const config = proposal();
    config.credentials.github[0] = {
      ...config.credentials.github[0],
      actAs,
      actions: [...actions],
    };
    const args = replay(render(config)).args.filter((arg) =>
      arg.startsWith("--credentials-github-"),
    );
    const parser = cmd.command({
      name: "credentials",
      args: managedCredentialOptions,
      handler: (value) => value,
    });
    const parsed = await cmd.run(parser, args);
    const resolved = await resolveManagedCredentials(parsed, {
      token: "unused",
      teamId: "team_selected",
      inferRepositoryImpl: async () => {
        throw new Error("Must not infer repository");
      },
      inferActorImpl: async ({ explicit }) => {
        expect(explicit).toBe(actAs);
        return { actAs: explicit! };
      },
    });
    expect(resolved?.config).toEqual(config);
  },
);

const complex: [string, (c: ManagedCredentialsConfig) => void][] = [
  [
    "multiple groups",
    (c) =>
      c.credentials.github.push({
        repositories: ["acme/other"],
        actions: ["github:issues:read"],
        actAs: "9",
      }),
  ],
  [
    "multiple repositories",
    (c) => c.credentials.github[0].repositories.push("acme/other"),
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
      c.source!.url = "https://github.com/acme/other.git";
    },
  ],
  [
    "noncanonical source spelling",
    (c) => {
      c.source!.url = "https://github.com/acme/widgets";
    },
  ],
  [
    "revision and depth",
    (c) => {
      c.source!.revision = "refs/heads/$topic";
      c.source!.depth = 3;
    },
  ],
  [
    "empty groups",
    (c) => {
      c.credentials.github = [];
    },
  ],
  [
    "missing actor",
    (c) => {
      delete c.credentials.github[0].actAs;
    },
  ],
];
test.each(complex)("omits recovery output for %s", (_, change) => {
  const config = proposal();
  change(config);
  const before = structuredClone(config);
  expect(render(config)).toBeUndefined();
  expect(config).toEqual(before);
});

test.each(shells)(
  "quotes scope values and requires explicit auth without printing its token in %s",
  (shell) => {
    const values = [
      "O'Neil",
      "$HOME ${USER} $(printf BAD >&2) `printf BAD >&2`",
      "line\nend\n",
      "\u001b[31m\r\b\u0007\u007f\u009b\u202e",
      "",
      "a; printf BAD >&2",
    ];
    for (const team of values) {
      const command = render(undefined, {
        team,
        project: team,
        hasExplicitToken: true,
      });
      expect(command).not.toContain("original-token-canary");
      expect(command).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202e]/);
      const { args } = replay(command, shell, {
        VERCEL_AUTH_TOKEN: "original-token-canary",
      });
      expect(args).toContain(`--scope=${team}`);
      expect(args).toContain(`--project=${team}`);
      expect(args).toContain("--token=original-token-canary");
    }
    const missing = spawnSync(
      shell,
      ["-c", render(undefined, { hasExplicitToken: true }) ?? ""],
      { encoding: "utf8", env: { PATH: process.env.PATH } },
    );
    expect(missing.status).not.toBe(0);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain(
      "Set VERCEL_AUTH_TOKEN to the original Vercel token",
    );
  },
);
