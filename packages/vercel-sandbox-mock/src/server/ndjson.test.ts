import { describe, expect, test } from "vitest";
import { ndjson } from "./ndjson";

describe("ndjson", () => {
  test("sets the x-ndjson content-type the SDK requires", () => {
    expect(ndjson([]).headers.get("content-type")).toBe("application/x-ndjson");
  });

  test("emits one JSON object per line", async () => {
    const response = ndjson([{ command: { id: "c1" } }, { stream: "stdout", data: "hi" }]);
    const text = await response.text();
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ command: { id: "c1" } });
    expect(JSON.parse(lines[1])).toEqual({ stream: "stdout", data: "hi" });
  });
});
