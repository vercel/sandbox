import { Duration } from "../../src/types/duration.ts";
import { describe, test, expect } from "vitest";

describe("Duration", () => {
  test("fails for invalid duration", async () => {
    await expect(Duration.from("invalid")).rejects
      .toThrowErrorMatchingInlineSnapshot(`
      [Error: Malformed duration: "invalid".
      hint: Use a number followed by a unit: s (seconds), m (minutes), h (hours), d (days).
      ╰▶ Examples: 30s, 5m, 2h, 1d]
    `);
  });

  test("parses a valid duration", async () => {
    await expect(Duration.from("10s")).resolves.toEqual("10s");
  });
});
