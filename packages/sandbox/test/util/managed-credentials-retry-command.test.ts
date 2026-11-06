import * as cmd from "cmd-ts";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

// Execute a shell stub, never the real CLI. It reads any fallback file while
// the command runs, then the shell trap must remove that file and preserve stdin.
const stub = `const fs = require("node:fs");
const args = process.argv.slice(1);
const file = args.find(x => x.startsWith("--credentials-github-from-config-file="))?.split("=")[1];
const stat = file ? fs.statSync(file) : undefined;
process.stdout.write(JSON.stringify({ args, input: fs.readFileSync(0, "utf8"), file,
config: file ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined,
mode: stat ? stat.mode & 511 : undefined, regular: stat?.isFile() }));
process.exitCode = Number(process.env.TEST_EXIT || 0);`;
const shells = ["/bin/bash", "/bin/zsh"].filter(existsSync);
function replay(
  command: string,
  shell = "/bin/bash",
  exit = 0,
  env: Record<string, string> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "sandbox-recovery-"));
  try {
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
        env: {
          PATH: process.env.PATH,
          TMPDIR: directory,
          TEST_EXIT: String(exit),
          ...env,
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(exit);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as {
      args: string[];
      input: string;
      config?: ManagedCredentialsConfig;
      file?: string;
      mode?: number;
      regular?: boolean;
    };
    expect(output.input).toBe("approval input\n");
    expect(readdirSync(directory)).toEqual([]);
    if (output.file) expect(existsSync(output.file)).toBe(false);
    return output;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
        return { actAs: explicit!, source: "explicit" };
      },
    });
    expect(resolved?.config).toEqual(config);
  },
);

const complex: [string, (c: ManagedCredentialsConfig) => void][] = [
  [
    "multiple groups",
    (c) => {
      c.credentials.github.push({
        repositories: ["acme/other"],
        actions: ["github:issues:read"],
        actAs: "9",
      });
    },
  ],
  [
    "multiple repositories",
    (c) => {
      c.credentials.github[0].repositories.push("acme/other");
    },
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
    "empty actions",
    (c) => {
      c.credentials.github[0].actions = [];
    },
  ],
  [
    "missing actor",
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
];
test.each(
  shells.flatMap((shell) =>
    complex.map(([name, change]) => ({ shell, name, change })),
  ),
)("replays $name as exact JSON in $shell", ({ shell, change }) => {
  const config = proposal();
  change(config);
  const before = structuredClone(config);
  const command = render(config);
  const result = replay(command, shell);
  expect(result.config).toEqual(config);
  expect(config).toEqual(before);
  expect(result.mode).toBe(0o600);
  expect(result.regular).toBe(true);
  expect(result.args).toEqual([
    "create",
    "--scope=team_selected",
    "--project=prj_selected",
    "--vcpus=6",
    `--credentials-github-from-config-file=${result.file}`,
  ]);
  expect(command).not.toContain("--yes");
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
      const { args } = replay(command, shell, 0, {
        VERCEL_AUTH_TOKEN: "original-token-canary",
      });
      expect(args).toContain(`--scope=${team}`);
      expect(args).toContain(`--project=${team}`);
      expect(args).toContain("--token=original-token-canary");
    }
    const missing = spawnSync(
      shell,
      ["-c", render(undefined, { hasExplicitToken: true })],
      { encoding: "utf8", env: { PATH: process.env.PATH } },
    );
    expect(missing.status).not.toBe(0);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain(
      "Set VERCEL_AUTH_TOKEN to the original Vercel token",
    );
  },
);

test.each(shells)(
  "keeps JSON inert, avoids delimiter collisions, and cleans up on CLI failure in %s",
  (shell) => {
    const config = proposal();
    config.source!.revision =
      "SANDBOX_MANAGED_CREDENTIALS\nSANDBOX_MANAGED_CREDENTIALS_\n$(printf BAD >&2)\nO'Neil\n\u001b[31m\u009b\u202e";
    const command = render(config);
    const marker = /<<'([^']+)'/.exec(command)?.[1];
    expect(marker).toBeTruthy();
    expect(JSON.stringify(config)).not.toContain(marker);
    expect(command).not.toMatch(/[\u001b\u007f-\u009f\u202e]/);
    expect(replay(command, shell, 7).config).toEqual(config);
  },
);
