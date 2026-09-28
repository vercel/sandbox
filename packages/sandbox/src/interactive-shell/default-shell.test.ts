import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defaultShell } from "./default-shell";

const prompt = "__SANDBOX_PROMPT__ ";

describe.skipIf(process.platform === "win32")(
  "default interactive shell",
  () => {
    let directory: string;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), "sandbox-shell-"));
      await symlink("/bin/sh", join(directory, "sh"));
      await writeFile(join(directory, ".bashrc"), "PS1=wrong-prompt\n");
    });

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    function runShell(input: string, shell = "") {
      return spawnSync(defaultShell.command, defaultShell.args, {
        cwd: directory,
        env: {
          PATH: directory,
          HOME: directory,
          PS1: prompt,
          SHELL: shell,
          HISTFILE: "/dev/null",
        },
        input,
        encoding: "utf8",
        timeout: 5000,
        killSignal: "SIGKILL",
      });
    }

    test.each([
      { hasBash: true, shell: "", expectedShell: "sh" },
      { hasBash: false, shell: "", expectedShell: "sh" },
      { hasBash: true, shell: "sh", expectedShell: "sh" },
      { hasBash: false, shell: "/bin/bash", expectedShell: "bash" },
    ])(
      "starts interactive $expectedShell with SHELL=$shell and preserves the prompt",
      async ({ hasBash, shell, expectedShell }) => {
        if (hasBash) await symlink("/bin/bash", join(directory, "bash"));
        const result = runShell(
          'printf "%s\\n" "${0##*/}" "$PS1"\ncase $- in *i*) printf "interactive\\n";; esac\nexit\n',
          shell,
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe(
          `${expectedShell}\n${prompt}\ninteractive\n`,
        );
      },
    );

    test("prefers the configured shell and only passes portable interactive flags", async () => {
      await symlink("/bin/bash", join(directory, "bash"));
      const shell = join(directory, "custom shell");
      await writeFile(shell, '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
        mode: 0o755,
      });
      const result = runShell("", shell);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("-i\n");
    });

    test("fails when the configured shell is unavailable", async () => {
      await symlink("/bin/bash", join(directory, "bash"));
      expect(runShell("", "missing-shell").status).toBe(127);
    });

    test("preserves the shell exit status", async () => {
      await symlink("/bin/bash", join(directory, "bash"));
      expect(runShell("exit 7\n", "bash").status).toBe(7);
    });
  },
);
