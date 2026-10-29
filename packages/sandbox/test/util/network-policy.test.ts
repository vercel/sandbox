import { describe, expect, test } from "vitest";
import { stripVTControlCharacters } from "node:util";
import { Redacted, type RequestHeader } from "../../src/args/network-policy.ts";
import type { NetworkPolicy } from "@vercel/sandbox";
import {
  buildNetworkPolicy,
  formatRequestHeaderNames,
} from "../../src/util/network-policy.ts";

function header(
  domain: string,
  name: string,
  value: string,
  methods?: string[],
): RequestHeader {
  return { domain, name, value: new Redacted(value), methods };
}

const empty = {
  allowedDomains: [] as string[],
  allowedCIDRs: [] as string[],
  deniedCIDRs: [] as string[],
  requestHeaders: [] as RequestHeader[],
  requestHeadersFromEnv: [] as RequestHeader[],
};

const registry = header(
  "registry.npmjs.org",
  "authorization",
  "Bearer npm_abc",
);

const rule = [
  { transform: [{ headers: { authorization: "Bearer npm_abc" } }] },
];

function text(error: unknown): string {
  return stripVTControlCharacters(
    error instanceof Error ? error.message : String(error),
  );
}

describe("buildNetworkPolicy", () => {
  test("one header allows that domain with one transform rule", () => {
    expect(
      buildNetworkPolicy({ ...empty, requestHeaders: [registry] }),
    ).toEqual({
      allow: {
        "registry.npmjs.org": rule,
      },
    });
  });

  test("merges a later allowed-domain star after the header domain", () => {
    const policy = buildNetworkPolicy({
      ...empty,
      allowedDomains: ["*"],
      requestHeaders: [registry],
    });

    expect(policy).toEqual({
      allow: {
        "registry.npmjs.org": rule,
        "*": [],
      },
    });
    if (policy === undefined || typeof policy === "string" || !policy.allow) {
      throw new Error("expected a record policy");
    }
    if (Array.isArray(policy.allow)) {
      throw new Error("expected a record policy");
    }
    expect(Object.keys(policy.allow)).toEqual(["registry.npmjs.org", "*"]);
  });

  test("does not move star to the end when it is not last in the flags", () => {
    const policy = buildNetworkPolicy({
      ...empty,
      allowedDomains: ["*", "github.com"],
      requestHeaders: [registry],
    });

    expect(policy).toEqual({
      allow: {
        "registry.npmjs.org": rule,
        "*": [],
        "github.com": [],
      },
    });
    if (policy === undefined || typeof policy === "string" || !policy.allow) {
      throw new Error("expected a record policy");
    }
    if (Array.isArray(policy.allow)) {
      throw new Error("expected a record policy");
    }
    expect(Object.keys(policy.allow)).toEqual([
      "registry.npmjs.org",
      "*",
      "github.com",
    ]);
  });

  test("naming the header domain again in --allowed-domain does not add a second rule", () => {
    expect(
      buildNetworkPolicy({
        ...empty,
        allowedDomains: ["registry.npmjs.org"],
        requestHeaders: [registry],
      }),
    ).toEqual({
      allow: {
        "registry.npmjs.org": rule,
      },
    });
  });

  test("merges two headers on one domain into one rule", () => {
    expect(
      buildNetworkPolicy({
        ...empty,
        requestHeaders: [
          registry,
          header("registry.npmjs.org", "x-npm-team", "acme"),
        ],
      }),
    ).toEqual({
      allow: {
        "registry.npmjs.org": [
          {
            transform: [
              {
                headers: {
                  authorization: "Bearer npm_abc",
                  "x-npm-team": "acme",
                },
              },
            ],
          },
        ],
      },
    });
  });

  test("rejects the same header twice on one domain, even with the same value", () => {
    expect(() =>
      buildNetworkPolicy({
        ...empty,
        requestHeaders: [registry, registry],
      }),
    ).toThrowError(
      [
        'Duplicate request header "authorization" for registry.npmjs.org.',
        "hint: Pass each header once per domain. Header names are case-insensitive.",
      ].join("\n"),
    );
  });

  test("merges --request-header-from-env headers into the same domain rule", () => {
    expect(
      buildNetworkPolicy({
        ...empty,
        requestHeaders: [header("registry.npmjs.org", "x-npm-team", "acme")],
        requestHeadersFromEnv: [registry],
      }),
    ).toEqual({
      allow: {
        "registry.npmjs.org": [
          {
            transform: [
              {
                headers: {
                  "x-npm-team": "acme",
                  authorization: "Bearer npm_abc",
                },
              },
            ],
          },
        ],
      },
    });
  });

  test("rejects the same header from both flags", () => {
    expect(() =>
      buildNetworkPolicy({
        ...empty,
        requestHeaders: [header("registry.npmjs.org", "authorization", "x")],
        requestHeadersFromEnv: [registry],
      }),
    ).toThrowError(
      [
        'Duplicate request header "authorization" for registry.npmjs.org.',
        "hint: Pass each header once per domain. Header names are case-insensitive.",
      ].join("\n"),
    );
  });

  test("keeps the same header name on two domains", () => {
    expect(
      buildNetworkPolicy({
        ...empty,
        requestHeaders: [
          header("a.com", "authorization", "1"),
          header("b.com", "authorization", "2"),
        ],
      }),
    ).toEqual({
      allow: {
        "a.com": [{ transform: [{ headers: { authorization: "1" } }] }],
        "b.com": [{ transform: [{ headers: { authorization: "2" } }] }],
      },
    });
  });

  test("rejects allow-all combined with a header", () => {
    let caught: unknown;
    try {
      buildNetworkPolicy({
        ...empty,
        networkPolicy: "allow-all",
        requestHeaders: [registry],
      });
    } catch (error) {
      caught = error;
    }

    expect(text(caught)).toBe(
      [
        "Cannot combine --network-policy=allow-all with --request-header or --request-header-from-env.",
        "hint: To set request headers and keep every other domain allowed, replace --network-policy=allow-all with --allowed-domain '*'.",
      ].join("\n"),
    );
  });

  test("rejects deny-all combined with a header", () => {
    let caught: unknown;
    try {
      buildNetworkPolicy({
        ...empty,
        networkPolicy: "deny-all",
        requestHeaders: [registry],
      });
    } catch (error) {
      caught = error;
    }

    expect(text(caught)).toBe(
      [
        "Cannot combine --network-policy=deny-all with --request-header or --request-header-from-env.",
        "hint: Drop --network-policy. A custom policy already denies every domain it does not allow.",
      ].join("\n"),
    );
  });

  test("keeps the existing mode-plus-list error when no header is set", () => {
    let caught: unknown;
    try {
      buildNetworkPolicy({
        ...empty,
        networkPolicy: "allow-all",
        allowedDomains: ["github.com"],
      });
    } catch (error) {
      caught = error;
    }

    expect(text(caught)).toBe(
      [
        "Cannot combine --network-policy=allow-all with --allowed-domain, --allowed-cidr, or --denied-cidr.",
        "hint: Use --allowed-domain / --allowed-cidr / --denied-cidr without --network-policy for custom policies.",
      ].join("\n"),
    );
  });

  test("adds allowed CIDRs beside the header rule", () => {
    expect(
      buildNetworkPolicy({
        ...empty,
        allowedCIDRs: ["10.0.0.0/8"],
        requestHeaders: [registry],
      }),
    ).toEqual({
      allow: { "registry.npmjs.org": rule },
      subnets: { allow: ["10.0.0.0/8"] },
    });
  });

  test("adds allowed and denied CIDRs beside the header rule", () => {
    expect(
      buildNetworkPolicy({
        ...empty,
        allowedCIDRs: ["10.0.0.0/8"],
        deniedCIDRs: ["10.1.0.0/16"],
        requestHeaders: [registry],
      }),
    ).toEqual({
      allow: { "registry.npmjs.org": rule },
      subnets: { allow: ["10.0.0.0/8"], deny: ["10.1.0.0/16"] },
    });
  });

  test("returns undefined when no network flag is given", () => {
    expect(buildNetworkPolicy(empty)).toBeUndefined();
  });

  test("keeps the string allow list when no header is set", () => {
    expect(buildNetworkPolicy({ ...empty, allowedDomains: ["a.com"] })).toEqual(
      { allow: ["a.com"] },
    );
  });

  test("keeps subnet-only policies in the old shape", () => {
    expect(
      buildNetworkPolicy({ ...empty, allowedCIDRs: ["10.0.0.0/8"] }),
    ).toEqual({ subnets: { allow: ["10.0.0.0/8"] } });
    expect(
      buildNetworkPolicy({ ...empty, deniedCIDRs: ["10.1.0.0/16"] }),
    ).toEqual({ subnets: { deny: ["10.1.0.0/16"] } });
  });

  test("returns a mode string when only a mode is set", () => {
    expect(buildNetworkPolicy({ ...empty, networkPolicy: "deny-all" })).toBe(
      "deny-all",
    );
  });
});

describe("buildNetworkPolicy with method matchers", () => {
  const npm = "registry.npmjs.org";
  const limited = header(npm, "authorization", "Bearer npm_abc", [
    "GET",
    "HEAD",
  ]);
  const source = header(npm, "x-source", "ci");

  test("limits a header to its methods", () => {
    expect(buildNetworkPolicy({ ...empty, requestHeaders: [limited] })).toEqual(
      {
        allow: {
          [npm]: [
            {
              match: { method: ["GET", "HEAD"] },
              transform: [{ headers: { authorization: "Bearer npm_abc" } }],
            },
          ],
        },
      },
    );
  });

  test("copies unlimited headers into the method rule and puts the unlimited rule last", () => {
    // The proxy applies only the first matching rule, so GET must get both.
    expect(
      buildNetworkPolicy({
        ...empty,
        requestHeaders: [source],
        requestHeadersFromEnv: [limited],
      }),
    ).toEqual({
      allow: {
        [npm]: [
          {
            match: { method: ["GET", "HEAD"] },
            transform: [
              {
                headers: { "x-source": "ci", authorization: "Bearer npm_abc" },
              },
            ],
          },
          { transform: [{ headers: { "x-source": "ci" } }] },
        ],
      },
    });
  });

  test("splits overlapping method lists so each method gets every header that lists it", () => {
    const write = header(npm, "x-write", "1", ["POST", "GET"]);
    expect(
      buildNetworkPolicy({ ...empty, requestHeaders: [limited, write] }),
    ).toEqual({
      allow: {
        [npm]: [
          {
            match: { method: ["GET"] },
            transform: [
              { headers: { authorization: "Bearer npm_abc", "x-write": "1" } },
            ],
          },
          {
            match: { method: ["HEAD"] },
            transform: [{ headers: { authorization: "Bearer npm_abc" } }],
          },
          {
            match: { method: ["POST"] },
            transform: [{ headers: { "x-write": "1" } }],
          },
        ],
      },
    });
  });

  test("allows one header name with different values on methods that do not overlap", () => {
    const writeToken = header(npm, "authorization", "Bearer npm_write", [
      "PUT",
    ]);
    expect(
      buildNetworkPolicy({ ...empty, requestHeaders: [limited, writeToken] }),
    ).toEqual({
      allow: {
        [npm]: [
          {
            match: { method: ["GET", "HEAD"] },
            transform: [{ headers: { authorization: "Bearer npm_abc" } }],
          },
          {
            match: { method: ["PUT"] },
            transform: [{ headers: { authorization: "Bearer npm_write" } }],
          },
        ],
      },
    });
  });

  const OVERLAP_ERROR = [
    'Duplicate request header "authorization" for registry.npmjs.org.',
    "hint: Limit each copy of a header to methods the other copies do not list. A header without [method=...] applies to every method.",
  ].join("\n");

  test("rejects one header name on overlapping methods", () => {
    expect(() =>
      buildNetworkPolicy({
        ...empty,
        requestHeaders: [
          limited,
          header(npm, "authorization", "Bearer other", ["HEAD"]),
        ],
      }),
    ).toThrowError(OVERLAP_ERROR);
  });

  test("rejects one header name both limited and unlimited", () => {
    expect(() =>
      buildNetworkPolicy({
        ...empty,
        requestHeaders: [registry],
        requestHeadersFromEnv: [limited],
      }),
    ).toThrowError(OVERLAP_ERROR);
  });

  test("keeps the same limited header on two domains apart", () => {
    const other = header("npm.pkg.github.com", "authorization", "Bearer gh", [
      "GET",
    ]);
    const policy = buildNetworkPolicy({
      ...empty,
      allowedDomains: ["*"],
      requestHeaders: [limited, other],
    });

    expect(policy).toEqual({
      allow: {
        [npm]: [
          {
            match: { method: ["GET", "HEAD"] },
            transform: [{ headers: { authorization: "Bearer npm_abc" } }],
          },
        ],
        "npm.pkg.github.com": [
          {
            match: { method: ["GET"] },
            transform: [{ headers: { authorization: "Bearer gh" } }],
          },
        ],
        "*": [],
      },
    });
  });

  test("names each header once, with the methods it is limited to", () => {
    const policy = buildNetworkPolicy({
      ...empty,
      requestHeaders: [source, limited],
    });

    expect(formatRequestHeaderNames(policy)).toBe(
      "registry.npmjs.org (x-source, authorization [GET,HEAD])",
    );
    expect(formatRequestHeaderNames(policy)).not.toContain("npm_abc");
  });
});

describe("formatRequestHeaderNames", () => {
  test("formats a policy just built", () => {
    const policy = buildNetworkPolicy({
      ...empty,
      requestHeaders: [
        registry,
        header("registry.npmjs.org", "x-npm-team", "acme"),
      ],
    });

    expect(formatRequestHeaderNames(policy)).toBe(
      "registry.npmjs.org (authorization, x-npm-team)",
    );
  });

  test("formats a read-back policy without printing redacted values", () => {
    const policy: NetworkPolicy = {
      allow: {
        "registry.npmjs.org": [
          { transform: [{ headers: { authorization: "<redacted>" } }] },
        ],
        "api.example.com": [
          { transform: [{ headers: { "x-api-key": "<redacted>" } }] },
        ],
        "*": [],
      },
    };

    expect(formatRequestHeaderNames(policy)).toBe(
      "registry.npmjs.org (authorization), api.example.com (x-api-key)",
    );
    expect(formatRequestHeaderNames(policy)).not.toContain("<redacted>");
  });

  test("formats several headers on a wildcard domain", () => {
    const policy: NetworkPolicy = {
      allow: {
        "registry.npmjs.org": [
          { transform: [{ headers: { authorization: "Bearer npm_abc" } }] },
        ],
        "*.example.com": [
          {
            transform: [{ headers: { "x-api-key": "k", "x-team-id": "acme" } }],
          },
        ],
      },
    };

    expect(formatRequestHeaderNames(policy)).toBe(
      "registry.npmjs.org (authorization), *.example.com (x-api-key, x-team-id)",
    );
    expect(formatRequestHeaderNames(policy)).not.toContain("Bearer npm_abc");
  });

  test("returns undefined when the policy sets no headers", () => {
    expect(formatRequestHeaderNames(undefined)).toBeUndefined();
    expect(formatRequestHeaderNames("allow-all")).toBeUndefined();
    expect(formatRequestHeaderNames("deny-all")).toBeUndefined();
    expect(formatRequestHeaderNames({ allow: ["a.com"] })).toBeUndefined();
    expect(formatRequestHeaderNames({ allow: { "*": [] } })).toBeUndefined();
  });
});
