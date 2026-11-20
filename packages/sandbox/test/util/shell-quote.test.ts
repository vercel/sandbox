import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { shellQuote } from "../../src/util/shell-quote.ts";

/** What a POSIX shell passes to a program for the quoted argument. */
function shellReads(quoted: string): string {
  return execFileSync("sh", ["-c", `printf %s ${quoted}`], {
    encoding: "utf8",
  });
}

describe("shellQuote", () => {
  test.each([
    "--scope=team_123",
    "--credentials-github-repository=acme/web.app",
    "--credentials-github-actions=git:write,github:issues:read",
    "--credentials-github-act-as=@octocat",
  ])("leaves %s as it is", (value) => {
    expect(shellQuote(value)).toBe(value);
  });

  test.each([
    "--scope=$(touch pwned)",
    "--scope=team; touch pwned",
    "--scope=`touch pwned`",
    "--project=a b",
    "--project=it's",
    "--project=a|b&c>d<e",
    "--project=*",
    "--project=~",
    "",
  ])("quotes %s so that a shell reads it back unchanged", (value) => {
    const quoted = shellQuote(value);
    expect(quoted).not.toBe(value);
    expect(shellReads(quoted)).toBe(value);
  });

  test.each(["--scope=a\nb", "--scope=a\u001b[2Jb", "--scope=a\rb"])(
    "writes no raw control character for %j",
    (value) => {
      expect(shellQuote(value)).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    },
  );
});
