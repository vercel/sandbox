import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defaultShell } from "./default-shell";

const prompt = "__SANDBOX_PROMPT__ ";

// Prints the shell name, the prompt, and "interactive" for an interactive shell.
const describeShell =
  'printf "%s\\n" "${0##*/}" "$PS1"\ncase $- in *i*) printf "interactive\\n";; esac\nexit\n';

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
        const result = runShell(describeShell, shell);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe(
          `${expectedShell}\n${prompt}\ninteractive\n`,
        );
      },
    );

    // Stub `id` and `getent` on PATH so that the passwd database gives
    // `loginShell` for the current user.
    async function setLoginShell(loginShell: string) {
      await writeFile(
        join(directory, "id"),
        '#!/bin/sh\n[ "$1" = -u ] && echo 1000\n',
        { mode: 0o755 },
      );
      await writeFile(
        join(directory, "getent"),
        `#!/bin/sh\n[ "$1 $2" = "passwd 1000" ] && echo "user:x:1000:1000::/home/user:${loginShell}"\n`,
        { mode: 0o755 },
      );
    }

    test.each([
      { login: "bin/bash", shell: "", expectedShell: "bash" },
      { login: "bin/bash", shell: "sh", expectedShell: "sh" },
      { login: "bin/nologin", shell: "", expectedShell: "sh" },
      { login: "bin/zsh", shell: "", expectedShell: "sh" },
    ])(
      "starts interactive $expectedShell with login shell $login and SHELL=$shell",
      async ({ login, shell, expectedShell }) => {
        // The login shells are not on PATH, so only passwd can select them.
        await mkdir(join(directory, "bin"));
        await symlink("/bin/bash", join(directory, "bin", "bash"));
        await writeFile(
          join(directory, "bin", "nologin"),
          "#!/bin/sh\nexit 1\n",
          { mode: 0o755 },
        );
        await setLoginShell(join(directory, login));
        const result = runShell(describeShell, shell);
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
