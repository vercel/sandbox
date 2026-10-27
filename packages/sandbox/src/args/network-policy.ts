import * as cmd from "cmd-ts";
import type { ParsingInto } from "cmd-ts/dist/esm/argparser";
import chalk from "chalk";

const networkPolicyMode = cmd.extendType(cmd.string, {
  displayName: "MODE",
  async from(value) {
    const validModes = ["allow-all", "deny-all"];
    if (!validModes.includes(value)) {
      throw new Error(
        [
          `Invalid network policy mode: ${value}.`,
          `${chalk.bold("hint:")} Valid modes are: ${validModes.join(", ")}`,
        ].join("\n"),
      );
    }
    return value as "allow-all" | "deny-all";
  },
});

export const networkPolicy = cmd.option({
  long: "network-policy",
  description:
    `Network policy mode: "allow-all" or "deny-all"
      - allow-all: sandbox can access any website/domain
      - deny-all: sandbox has no network access
    Omit this option and use --allowed-domain / --allowed-cidr / --denied-cidr / --request-header for custom policies.`,
  type: cmd.optional(networkPolicyMode),
});

export const allowedDomains = cmd.multioption({
  long: "allowed-domain",
  description:
    `Domain to allow traffic to (creates a custom network policy). Supports "*" for wildcards for a segment (e.g. '*.vercel.com', 'www.*.com'). If used as the first segment, will match any subdomain.`,
  type: cmd.array(cmd.string),
});

export const allowedCIDRs = cmd.multioption({
  long: "allowed-cidr",
  description:
    `CIDR to allow traffic to (creates a custom network policy). Takes precedence over 'allowed-domain'.`,
  type: cmd.array(cmd.string),
});

export const deniedCIDRs = cmd.multioption({
  long: "denied-cidr",
  description:
    `CIDR to deny traffic to (creates a custom network policy). Takes precedence over allowed domains/CIDRs.`,
  type: cmd.array(cmd.string),
});

export class Redacted {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return "<redacted>";
  }

  toJSON(): string {
    return "<redacted>";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "<redacted>";
  }
}

export type RequestHeader = {
  readonly domain: string;
  readonly name: string;
  readonly envVar: string;
  readonly value: Redacted;
};

const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED_DOMAIN_SYNTAX = /^\[|[ /?@:=]/;

const INLINE_HINT =
  'Header values are read from an environment variable, never the command line: NAME="Bearer ..." sandbox ... --request-header domain:header:NAME';
const MATCHER_HINT =
  "Path and method matchers are not supported by the CLI yet. Use the SDK's networkPolicy rules.";

function fail(message: string, hint: string): never {
  throw new Error([message, `${chalk.bold("hint:")} ${hint}`].join("\n"));
}

export function parseRequestHeader(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): RequestHeader {
  const last = input.lastIndexOf(":");
  const mid = last <= 0 ? -1 : input.lastIndexOf(":", last - 1);
  if (mid <= 0) {
    fail("Invalid --request-header value.", INLINE_HINT);
  }

  const envVar = input.slice(last + 1);
  const nameRaw = input.slice(mid + 1, last);
  const domain = input.slice(0, mid);

  if (!ENV_VAR_NAME.test(envVar)) {
    fail(
      "Invalid environment variable name in --request-header.",
      "Use a name matching [A-Za-z_][A-Za-z0-9_]*, for example NPM_AUTH.",
    );
  }

  if (!HEADER_TOKEN.test(nameRaw)) {
    fail(
      `Invalid header name for environment variable ${envVar}.`,
      "Header names are RFC 9110 tokens.",
    );
  }
  const name = nameRaw.toLowerCase();

  if (RESERVED_DOMAIN_SYNTAX.test(domain)) {
    fail(`Invalid domain for header ${name} from ${envVar}.`, MATCHER_HINT);
  }

  const raw = env[envVar];
  if (raw === undefined) {
    fail(
      `Environment variable ${envVar} is not set for header ${name} on ${domain}.`,
      `Set ${envVar} to the full header value, e.g. ${envVar}="Bearer $NPM_TOKEN".`,
    );
  }
  if (raw === "") {
    fail(
      `Environment variable ${envVar} is empty for header ${name} on ${domain}.`,
      `Set ${envVar} to the full header value, e.g. ${envVar}="Bearer $NPM_TOKEN".`,
    );
  }
  if (raw.includes("\r") || raw.includes("\n")) {
    fail(
      `Environment variable ${envVar} contains a carriage return or line feed.`,
      "Header values must be a single line.",
    );
  }

  return { domain, name, envVar, value: new Redacted(raw) };
}

const requestHeaderType = cmd.extendType(cmd.string, {
  displayName: "domain:header:ENV_VAR",
  async from(input) {
    return parseRequestHeader(input);
  },
});

export const requestHeaders = cmd.multioption({
  long: "request-header",
  description: `Set an HTTP request header on outbound requests to a domain (creates a custom network policy). Format "domain:header:ENV_VAR". The value is read from the environment variable ENV_VAR, so it never appears in the command line. The domain is allowed implicitly. Add --allowed-domain '*' to keep every other domain allowed. Supports the same wildcards as --allowed-domain.`,
  type: cmd.array(requestHeaderType),
});

export { networkPolicyMode };

export const networkPolicyArgs = {
  networkPolicy,
  allowedDomains,
  allowedCIDRs,
  deniedCIDRs,
  requestHeaders,
} as const;

export type NetworkPolicyArgs = {
  [K in keyof typeof networkPolicyArgs]: ParsingInto<
    (typeof networkPolicyArgs)[K]
  >;
};
