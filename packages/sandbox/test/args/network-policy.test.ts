import { describe, expect, test } from "vitest";
import { inspect, stripVTControlCharacters } from "node:util";
import { parseRequestHeader, Redacted } from "../../src/args/network-policy.ts";

const SECRET = "Bearer npm_abc==";

function text(error: unknown): string {
  return stripVTControlCharacters(
    error instanceof Error ? error.message : String(error),
  );
}

function parseError(input: string): string {
  try {
    parseRequestHeader(input);
  } catch (error) {
    return text(error);
  }
  throw new Error(`expected parse to fail for ${input}`);
}

const MATCHER_HINT =
  "hint: Path and method matchers are not supported by the CLI yet. Use the SDK's networkPolicy rules.";
const FORMAT_ERROR = [
  "Invalid --request-header value.",
  "hint: Use domain:header:value, for example registry.npmjs.org:authorization:Bearer <token>.",
].join("\n");

describe("parseRequestHeader", () => {
  test("takes the literal value after the second colon, including spaces and padding", () => {
    const parsed = parseRequestHeader(
      `registry.npmjs.org:authorization:${SECRET}`,
    );

    expect(parsed.domain).toBe("registry.npmjs.org");
    expect(parsed.name).toBe("authorization");
    expect(parsed.value.reveal()).toBe("Bearer npm_abc==");
  });

  test("keeps colons and equals signs in the value", () => {
    const parsed = parseRequestHeader(
      "api.example.com:x-forwarded:https://a.example/b?c=d:e",
    );

    expect(parsed.domain).toBe("api.example.com");
    expect(parsed.name).toBe("x-forwarded");
    expect(parsed.value.reveal()).toBe("https://a.example/b?c=d:e");
  });

  test("accepts wildcard domains and lowercases the header name", () => {
    const wildcard = parseRequestHeader("*.example.com:X-Api-Key:k");
    const star = parseRequestHeader("*:x-trace:1");
    const dotted = parseRequestHeader("www.*.com:X.Trace:1");

    expect(wildcard.domain).toBe("*.example.com");
    expect(wildcard.name).toBe("x-api-key");
    expect(wildcard.value.reveal()).toBe("k");
    expect(star.domain).toBe("*");
    expect(star.name).toBe("x-trace");
    expect(dotted.domain).toBe("www.*.com");
    expect(dotted.name).toBe("x.trace");
  });

  test("accepts a bracket that is not a leading matcher prefix", () => {
    const parsed = parseRequestHeader(`foo[bar].com:authorization:${SECRET}`);

    expect(parsed.domain).toBe("foo[bar].com");
    expect(parsed.name).toBe("authorization");
  });

  test.each([
    ["one colon", "api.example.com:x-token"],
    ["no colon", "api.example.com"],
    ["an empty domain", ":authorization:ZZSECRETZZ"],
  ])("rejects %s without echoing the input", (_label, input) => {
    const message = parseError(input);

    expect(message).toBe(FORMAT_ERROR);
    expect(message).not.toContain(input);
    expect(message).not.toContain("ZZSECRETZZ");
  });

  test("rejects a bad header token without echoing the input", () => {
    const input = "registry.npmjs.org:bad header:ZZSECRETZZ";
    const message = parseError(input);

    expect(message).toBe(
      [
        "Invalid header name in --request-header.",
        "hint: Header names are RFC 9110 tokens.",
      ].join("\n"),
    );
    expect(message).not.toContain("bad header");
    expect(message).not.toContain("registry.npmjs.org");
    expect(message).not.toContain("ZZSECRETZZ");
  });

  test("rejects an empty header name without echoing the value", () => {
    const message = parseError("registry.npmjs.org::ZZSECRETZZ");

    expect(message).toBe(
      [
        "Invalid header name in --request-header.",
        "hint: Header names are RFC 9110 tokens.",
      ].join("\n"),
    );
    expect(message).not.toContain("ZZSECRETZZ");
  });

  test.each([
    ["space", "ZZDOMAINZZ domain.com"],
    ["slash", "ZZDOMAINZZ/v1"],
    ["question mark", "ZZDOMAINZZ?.com"],
    ["at", "user@ZZDOMAINZZ.com"],
    ["equals", "ZZDOMAINZZ=domain.com"],
    ["leading bracket", "[ZZDOMAINZZ.com"],
  ])(
    "rejects reserved domain syntax %s without echoing the domain or value",
    (_label, domain) => {
      const message = parseError(`${domain}:authorization:${SECRET}`);

      expect(message).toBe(
        ["Invalid domain for header authorization.", MATCHER_HINT].join("\n"),
      );
      expect(message).not.toContain("ZZDOMAINZZ");
      expect(message).not.toContain(SECRET);
    },
  );

  test("rejects an empty value and names only the validated parts", () => {
    const message = parseError("registry.npmjs.org:authorization:");

    expect(message).toBe(
      [
        "Header authorization for registry.npmjs.org has an empty value.",
        "hint: Put the value after the second colon: domain:header:value.",
      ].join("\n"),
    );
  });

  test.each([
    ["carriage return", "ZZSECRETZZ\rmore"],
    ["line feed", "ZZSECRETZZ\nmore"],
  ])("rejects a %s in the value without echoing it", (_label, value) => {
    const message = parseError(`registry.npmjs.org:authorization:${value}`);

    expect(message).toBe(
      [
        "Header authorization for registry.npmjs.org contains a carriage return or line feed.",
        "hint: Header values must be a single line.",
      ].join("\n"),
    );
    expect(message).not.toContain("ZZSECRETZZ");
  });
});

describe("Redacted", () => {
  test("String, a template, JSON, and inspect all print <redacted>", () => {
    const value = new Redacted(SECRET);

    expect(String(value)).toBe("<redacted>");
    expect(`${value}`).toBe("<redacted>");
    expect(JSON.stringify(value)).toBe('"<redacted>"');
    expect(inspect(value)).toBe("<redacted>");
    expect(JSON.stringify({ value })).toBe('{"value":"<redacted>"}');
    expect(inspect({ value })).not.toContain("npm_abc");
    expect(inspect({ value })).toContain("<redacted>");
  });
});
