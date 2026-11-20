import { afterAll, describe, expect, test } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { SandboxCredentials } from "@vercel/sandbox";
import { readCredentialsFile } from "../../src/args/credentials.ts";
import {
  checkCredentialsOutput,
  writeCredentialsOutput,
} from "../../src/util/credentials-output.ts";

const directory = mkdtempSync(join(tmpdir(), "credentials-output-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const credentials: SandboxCredentials = {
  npm: true,
  github: [
    {
      repositories: ["acme/web"],
      actions: ["git:write", "github:pull-request:create"],
      actAs: "@octocat",
    },
  ],
};

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return stripVTControlCharacters((error as Error).message);
  }
  throw new Error("expected the promise to reject");
}

describe("checkCredentialsOutput", () => {
  test("accepts a new file in an existing directory", async () => {
    await expect(
      checkCredentialsOutput(join(directory, "new.json"), credentials),
    ).resolves.toBeUndefined();
  });

  test("accepts the absence of the option", async () => {
    await expect(
      checkCredentialsOutput(undefined, undefined),
    ).resolves.toBeUndefined();
  });

  test("needs a credentials request to write", async () => {
    expect(
      await failure(
        checkCredentialsOutput(join(directory, "new.json"), undefined),
      ),
    ).toBe(
      [
        "--credentials-output has no credentials request to write.",
        "hint: Request credentials with --credentials, the --credentials-github-* options, or --credentials-file.",
      ].join("\n"),
    );
  });

  test("does not write to stdout", async () => {
    expect(await failure(checkCredentialsOutput("-", credentials))).toBe(
      [
        "--credentials-output cannot write to stdout, which carries the sandbox name.",
        "hint: Pass the path of a file to create.",
      ].join("\n"),
    );
  });

  test("does not overwrite a file", async () => {
    const path = join(directory, "existing.json");
    writeFileSync(path, "{}");
    expect(await failure(checkCredentialsOutput(path, credentials))).toBe(
      [
        `Cannot write the credentials request to ${path}: the file already exists.`,
        "hint: --credentials-output never overwrites a file. Choose another path, or remove the file first.",
      ].join("\n"),
    );
    expect(readFileSync(path, "utf8")).toBe("{}");
  });

  test("needs the directory to exist", async () => {
    const path = join(directory, "missing", "new.json");
    expect(await failure(checkCredentialsOutput(path, credentials))).toBe(
      [
        `Cannot write the credentials request to ${path}: its directory does not exist.`,
        "hint: Create the directory first, or choose another path.",
      ].join("\n"),
    );
  });
});

describe("checkCredentialsOutput in a directory without write permission", () => {
  // Permission bits do not stop the root user.
  test.skipIf(process.getuid?.() === 0)(
    "refuses the path before a sandbox is created",
    async () => {
      const readOnly = join(directory, "read-only");
      mkdirSync(readOnly, { mode: 0o555 });
      const path = join(readOnly, "new.json");

      expect(await failure(checkCredentialsOutput(path, credentials))).toBe(
        [
          `Cannot write the credentials request to ${path}: its directory is not writable.`,
          "hint: Choose a path in a directory that you can write to.",
        ].join("\n"),
      );
    },
  );
});

describe("writeCredentialsOutput", () => {
  test("writes a file that --credentials-file reads back unchanged", async () => {
    const path = join(directory, "round-trip.json");
    await writeCredentialsOutput(path, credentials, "my-sandbox");

    expect(readFileSync(path, "utf8")).toBe(
      `${JSON.stringify(credentials, null, 2)}\n`,
    );
    await expect(readCredentialsFile(path)).resolves.toEqual(credentials);
  });

  test("says the sandbox exists when the write fails, and leaves the file alone", async () => {
    const path = join(directory, "raced.json");
    writeFileSync(path, "{}");

    expect(
      await failure(writeCredentialsOutput(path, credentials, "my-sandbox")),
    ).toBe(
      [
        `Sandbox my-sandbox was created, but its credentials request could not be written to ${path} (EEXIST).`,
        "hint: Do not rerun the command to retry the write, because that creates another sandbox.",
      ].join("\n"),
    );
    expect(readFileSync(path, "utf8")).toBe("{}");
  });
});
