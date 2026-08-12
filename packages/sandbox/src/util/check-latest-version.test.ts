import { describe, it, expect } from "vitest";
import { isOutdated } from "./check-latest-version";

describe("isOutdated", () => {
  it("flags older majors, minors and patches", () => {
    expect(isOutdated("3.5.2", "4.0.0")).toBe(true);
    expect(isOutdated("4.0.0", "4.1.0")).toBe(true);
    expect(isOutdated("4.1.0", "4.1.1")).toBe(true);
  });

  it("does not flag equal or newer versions", () => {
    expect(isOutdated("4.0.0", "4.0.0")).toBe(false);
    expect(isOutdated("4.1.0", "4.0.9")).toBe(false);
    expect(isOutdated("5.0.0", "4.9.9")).toBe(false);
  });

  it("opts out for prerelease versions on either side", () => {
    expect(isOutdated("4.1.0-beta.0", "4.1.0")).toBe(false);
    expect(isOutdated("4.0.0", "4.1.0-beta.0")).toBe(false);
  });

  it("opts out when a segment is not numeric", () => {
    expect(isOutdated("4.0.0", "not-a-version")).toBe(false);
  });
});
