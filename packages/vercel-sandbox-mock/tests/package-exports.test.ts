import { describe, expect, test } from "vitest";
import * as real from "@vercel/sandbox";
import * as mock from "../src/index";
import * as realProxy from "@vercel/sandbox/proxy";
import * as mockProxy from "../src/proxy";
import { Sandbox as RealSandbox, Snapshot as RealSnapshot } from "@vercel/sandbox";

describe("public exports", () => {
  test("re-exports every runtime value the real SDK exposes", () => {
    const realValues = Object.keys(real).filter(
      (key) => typeof (real as Record<string, unknown>)[key] !== "undefined",
    );
    for (const name of realValues) {
      expect(mock, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  test("adds the mock-specific stubbing helpers", () => {
    expect(typeof mock.command).toBe("function");
    expect(typeof mock.setupSandbox).toBe("function");
  });

  test("the ./proxy entry point re-exports the real proxy surface", () => {
    for (const name of Object.keys(realProxy)) {
      expect(mockProxy, `missing proxy export: ${name}`).toHaveProperty(name);
    }
  });

  test("Sandbox and Snapshot are drop-in subclasses of the real classes", () => {
    expect(mock.Sandbox.prototype).toBeInstanceOf(RealSandbox);
    expect(mock.Snapshot.prototype).toBeInstanceOf(RealSnapshot);
  });
});
