import { describe, it, expect } from "vitest";
import { formatNextCursorHint } from "./output";

describe("formatNextCursorHint", () => {
  it("emits just the command with cursor when no flags are active", () => {
    expect(
      formatNextCursorHint(
        "sandbox list",
        [
          { long: "all", value: false },
          { long: "name-prefix", value: undefined },
        ],
        "cur123",
      ),
    ).toBe("More results: sandbox list --cursor cur123");
  });

  it("renders boolean flags without a value", () => {
    expect(
      formatNextCursorHint(
        "sandbox list",
        [{ long: "all", value: true }],
        "cur1",
      ),
    ).toBe("More results: sandbox list --all --cursor cur1");
  });

  it("serializes string, number, and array values", () => {
    expect(
      formatNextCursorHint(
        "sandbox list",
        [
          { long: "name-prefix", value: "ci-" },
          { long: "limit", value: 10 },
          { long: "tag", value: ["env=prod", "team=core"] },
        ],
        "cur9",
      ),
    ).toBe(
      "More results: sandbox list --name-prefix ci- --limit 10 --tag env=prod --tag team=core --cursor cur9",
    );
  });

  it("shell-escapes values with special chars", () => {
    expect(
      formatNextCursorHint(
        "sandbox list",
        [{ long: "name-prefix", value: "has space" }],
        "cur",
      ),
    ).toBe("More results: sandbox list --name-prefix 'has space' --cursor cur");
  });

  it("handles positional arguments before flags", () => {
    expect(
      formatNextCursorHint(
        "sandbox sessions list",
        [{ long: "limit", value: 5 }],
        "abc",
        ["my-sandbox"],
      ),
    ).toBe(
      "More results: sandbox sessions list my-sandbox --limit 5 --cursor abc",
    );
  });

  it("shell-escapes positional arguments with special chars", () => {
    expect(
      formatNextCursorHint("sandbox sessions list", [], "cur", ["has space"]),
    ).toBe("More results: sandbox sessions list 'has space' --cursor cur");
  });

  it("escapes values containing single quotes", () => {
    expect(
      formatNextCursorHint(
        "sandbox list",
        [{ long: "name-prefix", value: "it's" }],
        "cur",
      ),
    ).toBe(`More results: sandbox list --name-prefix 'it'\\''s' --cursor cur`);
  });

  it("treats empty string as needing quotes", () => {
    expect(
      formatNextCursorHint(
        "sandbox list",
        [{ long: "name-prefix", value: "" }],
        "cur",
      ),
    ).toBe("More results: sandbox list --name-prefix '' --cursor cur");
  });

  it("skips flags whose value is undefined", () => {
    expect(
      formatNextCursorHint(
        "sandbox list",
        [
          { long: "sort-by", value: undefined },
          { long: "limit", value: 20 },
          { long: "sort-order", value: undefined },
        ],
        "cur",
      ),
    ).toBe("More results: sandbox list --limit 20 --cursor cur");
  });

  it("skips empty arrays", () => {
    expect(
      formatNextCursorHint(
        "sandbox list",
        [{ long: "tag", value: [] }],
        "cur",
      ),
    ).toBe("More results: sandbox list --cursor cur");
  });
});
