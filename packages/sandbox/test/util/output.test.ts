import { formatBytes } from "../../src/util/output.ts";
import { describe, test, expect } from "vitest";

describe("formatBytes", () => {
  test("labels 1024-based values with binary units", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1024)).toBe("1 KiB");
    expect(formatBytes(1024 ** 2)).toBe("1 MiB");
    expect(formatBytes(1024 ** 3)).toBe("1 GiB");
    expect(formatBytes(1024 ** 4)).toBe("1 TiB");
  });

  test("matches the documented drive sizes", () => {
    // default drive size and the default quota ceiling from the Drives docs
    expect(formatBytes(1024 ** 4)).toBe("1 TiB");
    expect(formatBytes(16 * 1024 ** 4)).toBe("16 TiB");
    // 100 GiB, the example value in the CLI reference (107374182400 bytes)
    expect(formatBytes(107374182400)).toBe("100 GiB");
  });
});
