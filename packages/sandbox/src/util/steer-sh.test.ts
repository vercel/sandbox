import { describe, it, expect } from "vitest";
import { steerShCommand } from "./steer-sh";
import { StyledError } from "../error";

describe("steerShCommand", () => {
  it("steers `sh <command>` to run --rm -i", () => {
    expect(() => steerShCommand(["sh", "claude"])).toThrowError(StyledError);
    try {
      steerShCommand(["sh", "claude"]);
    } catch (err) {
      expect((err as Error).message).toContain(
        "doesn't take a command",
      );
      expect((err as Error).message).toContain("sandbox run -i claude");
      // Kept deliberately terse: no --rm and no persistence lesson in the
      // steer; cleanup guidance lives in run's own help.
      expect((err as Error).message).not.toContain("--rm");
    }
  });

  it("joins multiple leading tokens into the example", () => {
    try {
      steerShCommand(["sh", "python3", "main.py"]);
    } catch (err) {
      expect((err as Error).message).toContain(
        "sandbox run -i python3 main.py",
      );
    }
  });

  it("keeps the command's own flags in the example", () => {
    try {
      steerShCommand(["sh", "example-command", "-t", "0"]);
    } catch (err) {
      expect((err as Error).message).toContain(
        "sandbox run -i example-command -t 0",
      );
    }
  });

  it("does nothing for a plain `sh`", () => {
    expect(() => steerShCommand(["sh"])).not.toThrow();
  });

  it("does nothing when sh only receives flags and option values", () => {
    expect(() =>
      steerShCommand(["sh", "--name", "my-box", "--timeout", "5m"]),
    ).not.toThrow();
  });

  it("does nothing for other commands", () => {
    expect(() => steerShCommand(["ls", "claude"])).not.toThrow();
    expect(() => steerShCommand([])).not.toThrow();
  });

  it("falls through on a force-positional marker", () => {
    expect(() => steerShCommand(["sh", "--", "claude"])).not.toThrow();
  });
});
