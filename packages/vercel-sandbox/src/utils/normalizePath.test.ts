import { describe, expect, it } from "vitest";
import { normalizePath } from "./normalizePath";

describe("normalizePath", () => {
  it("handles base cases", () => {
    expect(
      normalizePath({
        filePath: "foo.txt",
        cwd: "/vercel/sandbox",
        extractDir: "/",
      }),
    ).toBe("vercel/sandbox/foo.txt");
    expect(
      normalizePath({
        filePath: "foo/bar/baz.txt",
        cwd: "/vercel/sandbox",
        extractDir: "/",
      }),
    ).toBe("vercel/sandbox/foo/bar/baz.txt");
    expect(
      normalizePath({ filePath: "bar.txt", cwd: "/", extractDir: "/" }),
    ).toBe("bar.txt");
    expect(
      normalizePath({
        filePath: "/some/other/dir/foo.txt",
        cwd: "/bar",
        extractDir: "/",
      }),
    ).toBe("some/other/dir/foo.txt");
  });

  it("handles base cases (extract dir)", () => {
    expect(
      normalizePath({
        filePath: "foo.txt",
        cwd: "/vercel/sandbox",
        extractDir: "/vercel",
      }),
    ).toBe("sandbox/foo.txt");
    expect(
      normalizePath({
        filePath: "foo/bar/baz.txt",
        cwd: "/vercel/sandbox",
        extractDir: "/vercel",
      }),
    ).toBe("sandbox/foo/bar/baz.txt");

    // TODO: Should this be allowed?
    expect(
      normalizePath({ filePath: "bar.txt", cwd: "/", extractDir: "/vercel" }),
    ).toBe("../bar.txt");
  });

  it("handles normalization", () => {
    expect(
      normalizePath({
        filePath: "/resolves/../this/stuff/foo.txt",
        cwd: "/bar",
        extractDir: "/",
      }),
    ).toBe("this/stuff/foo.txt");
    expect(
      normalizePath({
        filePath: "/handles//extra-slashes",
        cwd: "/",
        extractDir: "/",
      }),
    ).toBe("handles/extra-slashes");
  });

  it("resolves relative paths", () => {
    expect(
      normalizePath({
        filePath: "/../../../foo.txt",
        cwd: "/",
        extractDir: "/",
      }),
    ).toBe("foo.txt");
    expect(
      normalizePath({
        filePath: "../../../../foo.txt",
        cwd: "/vercel/sandbox",
        extractDir: "/",
      }),
    ).toBe("foo.txt");
    expect(
      normalizePath({
        filePath: "../foo.txt",
        cwd: "/vercel/sandbox",
        extractDir: "/",
      }),
    ).toBe("vercel/foo.txt");
  });

  it("validates the cwd", () => {
    expect(() => {
      normalizePath({
        filePath: "doesn't matter",
        cwd: "relative/root",
        extractDir: "/",
      });
    }).toThrow("cwd dir must be absolute");
  });

  it("validates the cwd", () => {
    expect(() => {
      normalizePath({
        filePath: "doesn't matter",
        cwd: "/",
        extractDir: "some/relative/path",
      });
    }).toThrow("extractDir must be absolute");
  });
});
