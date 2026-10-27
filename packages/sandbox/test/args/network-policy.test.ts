import { describe, expect, test } from "vitest";
import { inspect, stripVTControlCharacters } from "node:util";
import { parseRequestHeader, Redacted } from "../../src/args/network-policy.ts";

const SECRET = "Bearer npm_abc==";

function text(error: unknown): string {
  return stripVTControlCharacters(
    error instanceof Error ? error.message : String(error),
  );
}

function parseError(input: string, env: NodeJS.ProcessEnv): string {
  try {
    parseRequestHeader(input, env);
  } catch (error) {
    return text(error);
  }
  throw new Error(`expected parse to fail for ${input}`);
}

describe("parseRequestHeader", () => {
  test("reads a valid value from the injected env, including spaces and padding", () => {
    const parsed = parseRequestHeader(
      "registry.npmjs.org:authorization:NPM_AUTH",
      { NPM_AUTH: SECRET },
    );

    expect(parsed.domain).toBe("registry.npmjs.org");
    expect(parsed.name).toBe("authorization");
    expect(parsed.envVar).toBe("NPM_AUTH");
    expect(parsed.value.reveal()).toBe("Bearer npm_abc==");
  });

  test("accepts wildcard domains and lowercases the header name", () => {
    const wildcard = parseRequestHeader("*.example.com:X-Api-Key:API_KEY", {
      API_KEY: "k",
    });
    const star = parseRequestHeader("*:x-trace:T", { T: "1" });
    const dotted = parseRequestHeader("www.*.com:X.Trace:T", { T: "1" });

    expect(wildcard.domain).toBe("*.example.com");
    expect(wildcard.name).toBe("x-api-key");
    expect(wildcard.value.reveal()).toBe("k");
    expect(star.domain).toBe("*");
    expect(star.name).toBe("x-trace");
    expect(dotted.domain).toBe("www.*.com");
    expect(dotted.name).toBe("x.trace");
  });

  test("accepts a bracket that is not a leading matcher prefix", () => {
    const parsed = parseRequestHeader("foo[bar].com:authorization:NPM_AUTH", {
      NPM_AUTH: SECRET,
    });

    expect(parsed.domain).toBe("foo[bar].com");
    expect(parsed.name).toBe("authorization");
  });

  test("rejects an unset variable and names only the validated parts", () => {
    const input = "registry.npmjs.org:authorization:NPM_AUTH";
    const message = parseError(input, {});

    expect(message).toBe(
      [
        "Environment variable NPM_AUTH is not set for header authorization on registry.npmjs.org.",
        'hint: Set NPM_AUTH to the full header value, e.g. NPM_AUTH="Bearer $NPM_TOKEN".',
      ].join("\n"),
    );
    expect(message).not.toContain(input);
    expect(message).not.toContain(SECRET);
  });

  test("rejects an empty variable and names only the validated parts", () => {
    const input = "registry.npmjs.org:authorization:NPM_AUTH";
    const message = parseError(input, { NPM_AUTH: "" });

    expect(message).toBe(
      [
        "Environment variable NPM_AUTH is empty for header authorization on registry.npmjs.org.",
        'hint: Set NPM_AUTH to the full header value, e.g. NPM_AUTH="Bearer $NPM_TOKEN".',
      ].join("\n"),
    );
    expect(message).not.toContain(input);
  });

  test("rejects an inline equals attempt without echoing the value", () => {
    const input = "registry.npmjs.org:authorization=Bearer ZZSECRETZZ";
    const message = parseError(input, {});

    expect(message).toBe(
      [
        "Invalid --request-header value.",
        'hint: Header values are read from an environment variable, never the command line: NAME="Bearer ..." sandbox ... --request-header domain:header:NAME',
      ].join("\n"),
    );
    expect(message).not.toContain("ZZSECRETZZ");
    expect(message).not.toContain(input);
  });

  test("rejects a flag with too few colons without echoing the input", () => {
    const input = "registry.npmjs.org:authorization";
    const message = parseError(input, { NPM_AUTH: SECRET });

    expect(message).toBe(
      [
        "Invalid --request-header value.",
        'hint: Header values are read from an environment variable, never the command line: NAME="Bearer ..." sandbox ... --request-header domain:header:NAME',
      ].join("\n"),
    );
    expect(message).not.toContain(input);
    expect(message).not.toContain(SECRET);
  });

  test("rejects a bad env var name without echoing it", () => {
    const input = "registry.npmjs.org:authorization:has space";
    const message = parseError(input, { "has space": SECRET });

    expect(message).toBe(
      [
        "Invalid environment variable name in --request-header.",
        "hint: Use a name matching [A-Za-z_][A-Za-z0-9_]*, for example NPM_AUTH.",
      ].join("\n"),
    );
    expect(message).not.toContain("has space");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain(input);
  });

  test("rejects a digit-leading env var name without echoing it", () => {
    const input = "registry.npmjs.org:authorization:9API";
    const message = parseError(input, { "9API": SECRET });

    expect(message).toBe(
      [
        "Invalid environment variable name in --request-header.",
        "hint: Use a name matching [A-Za-z_][A-Za-z0-9_]*, for example NPM_AUTH.",
      ].join("\n"),
    );
    expect(message).not.toContain("9API");
    expect(message).not.toContain(input);
  });

  test("rejects a bad header token without echoing it", () => {
    const input = "registry.npmjs.org:bad header:NPM_AUTH";
    const message = parseError(input, { NPM_AUTH: SECRET });

    expect(message).toBe(
      [
        "Invalid header name for environment variable NPM_AUTH.",
        "hint: Header names are RFC 9110 tokens.",
      ].join("\n"),
    );
    expect(message).not.toContain("bad header");
    expect(message).not.toContain("registry.npmjs.org");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain(input);
  });

  test.each([
    ["space", "ZZSECRETZZ domain.com"],
    ["slash", "ZZSECRETZZ/v1"],
    ["question mark", "ZZSECRETZZ?.com"],
    ["at", "user@ZZSECRETZZ.com"],
    ["colon", "ZZSECRETZZ:extra"],
    ["equals", "ZZSECRETZZ=domain.com"],
  ])(
    "rejects reserved domain character %s without echoing the domain",
    (_label, domain) => {
      const input = `${domain}:authorization:NPM_AUTH`;
      const message = parseError(input, { NPM_AUTH: SECRET });

      expect(message).toBe(
        [
          "Invalid domain for header authorization from NPM_AUTH.",
          "hint: Path and method matchers are not supported by the CLI yet. Use the SDK's networkPolicy rules.",
        ].join("\n"),
      );
      expect(message).not.toContain("ZZSECRETZZ");
      expect(message).not.toContain(domain);
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(input);
    },
  );

  test("rejects a leading bracket without echoing the domain", () => {
    const input = "[ZZSECRETZZ.com:authorization:NPM_AUTH";
    const message = parseError(input, { NPM_AUTH: SECRET });

    expect(message).toBe(
      [
        "Invalid domain for header authorization from NPM_AUTH.",
        "hint: Path and method matchers are not supported by the CLI yet. Use the SDK's networkPolicy rules.",
      ].join("\n"),
    );
    expect(message).not.toContain("ZZSECRETZZ");
    expect(message).not.toContain(input);
    expect(message).not.toContain(SECRET);
  });

  test("rejects a carriage return in the value and names only the variable", () => {
    const message = parseError("registry.npmjs.org:authorization:NPM_AUTH", {
      NPM_AUTH: "ZZSECRETZZ\rmore",
    });

    expect(message).toBe(
      [
        "Environment variable NPM_AUTH contains a carriage return or line feed.",
        "hint: Header values must be a single line.",
      ].join("\n"),
    );
    expect(message).not.toContain("ZZSECRETZZ");
  });

  test("rejects a line feed in the value and names only the variable", () => {
    const message = parseError("registry.npmjs.org:authorization:NPM_AUTH", {
      NPM_AUTH: "ZZSECRETZZ\nmore",
    });

    expect(message).toBe(
      [
        "Environment variable NPM_AUTH contains a carriage return or line feed.",
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
