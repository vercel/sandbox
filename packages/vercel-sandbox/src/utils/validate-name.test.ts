import { describe, expect, it } from "vitest";
import { validateName } from "./validate-name.js";

describe("validateName", () => {
  it("accepts valid names", () => {
    expect(() => validateName("alice", "username")).not.toThrow();
    expect(() => validateName("_user", "username")).not.toThrow();
    expect(() => validateName("user-name", "username")).not.toThrow();
    expect(() => validateName("user_123", "username")).not.toThrow();
    expect(() => validateName("a", "username")).not.toThrow();
    expect(() => validateName("a".repeat(32), "username")).not.toThrow();
    expect(() => validateName("devs", "group name")).not.toThrow();
  });

  it("rejects empty names", () => {
    expect(() => validateName("", "username")).toThrow("must not be empty");
  });

  it("rejects names longer than 32 characters", () => {
    expect(() => validateName("a".repeat(33), "username")).toThrow(
      "must be at most 32 characters",
    );
  });

  it("rejects names with an invalid regex", () => {
    expect(() => validateName("INVALID_REGEX", "username")).toThrow("Invalid username");
  });

  it("rejects names that do not start with a letter or underscore", () => {
    expect(() => validateName("1user", "username")).toThrow("Invalid username");
    expect(() => validateName("-user", "username")).toThrow("Invalid username");
  });
});
