import * as cmd from "cmd-ts";
import type { ParsingInto } from "cmd-ts/dist/esm/argparser";
import chalk from "chalk";
import { readFile } from "node:fs/promises";
import {
  NetworkPolicyParseError,
  parseNetworkPolicy,
  type NetworkPolicy,
} from "@vercel/sandbox";

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
  description: `Network policy mode: "allow-all" or "deny-all"
      - allow-all: sandbox can access any website/domain
      - deny-all: sandbox has no network access
    Omit this option and use --allowed-domain / --allowed-cidr / --denied-cidr / --request-header / --request-header-from-env / --network-policy-file for custom policies.`,
  type: cmd.optional(networkPolicyMode),
});

export const allowedDomains = cmd.multioption({
  long: "allowed-domain",
  description: `Domain to allow traffic to (creates a custom network policy). Supports "*" for wildcards for a segment (e.g. '*.vercel.com', 'www.*.com'). If used as the first segment, will match any subdomain.`,
  type: cmd.array(cmd.string),
});

export const allowedCIDRs = cmd.multioption({
  long: "allowed-cidr",
  description: `CIDR to allow traffic to (creates a custom network policy). Takes precedence over 'allowed-domain'.`,
  type: cmd.array(cmd.string),
});

export const deniedCIDRs = cmd.multioption({
  long: "denied-cidr",
  description: `CIDR to deny traffic to (creates a custom network policy). Takes precedence over allowed domains/CIDRs.`,
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
  readonly value: Redacted;
};

const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED_DOMAIN_SYNTAX = /^\[|[ /?@=]/;
const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const MATCHER_HINT =
  "--request-header does not take path or method matchers. To use them, write the policy as JSON and pass it with --network-policy-file.";
const SINGLE_LINE_HINT = "Header values must be a single line.";

function fail(message: string, hint: string): never {
  throw new Error([message, `${chalk.bold("hint:")} ${hint}`].join("\n"));
}

function splitRequestHeader(
  input: string,
  flag: string,
  formatHint: string,
): { domain: string; name: string; rest: string } {
  const first = input.indexOf(":");
  const second = first <= 0 ? -1 : input.indexOf("=", first + 1);
  if (second < 0) {
    fail(`Invalid ${flag} value.`, formatHint);
  }

  const domain = input.slice(0, first);
  const nameRaw = input.slice(first + 1, second);

  if (!HEADER_TOKEN.test(nameRaw)) {
    fail(
      `Invalid header name in ${flag}.`,
      "Header names are RFC 9110 tokens.",
    );
  }
  const name = nameRaw.toLowerCase();

  if (RESERVED_DOMAIN_SYNTAX.test(domain)) {
    fail(`Invalid domain for header ${name}.`, MATCHER_HINT);
  }

  return { domain, name, rest: input.slice(second + 1) };
}

function isMultiline(value: string): boolean {
  return value.includes("\r") || value.includes("\n");
}

export function parseRequestHeader(input: string): RequestHeader {
  const {
    domain,
    name,
    rest: value,
  } = splitRequestHeader(
    input,
    "--request-header",
    "Use domain:header=value, for example example.com:x-source=ci.",
  );

  if (value === "") {
    fail(
      `Header ${name} for ${domain} has an empty value.`,
      "Put the value after the equals sign: domain:header=value.",
    );
  }
  if (isMultiline(value)) {
    fail(
      `Header ${name} for ${domain} contains a carriage return or line feed.`,
      SINGLE_LINE_HINT,
    );
  }

  return { domain, name, value: new Redacted(value) };
}

export function parseRequestHeaderFromEnv(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): RequestHeader {
  const {
    domain,
    name,
    rest: envVar,
  } = splitRequestHeader(
    input,
    "--request-header-from-env",
    "Use domain:header=ENV_VAR, for example registry.npmjs.org:authorization=NPM_AUTH.",
  );

  if (!ENV_VAR_NAME.test(envVar)) {
    fail(
      "Invalid environment variable name in --request-header-from-env.",
      "Use a name matching [A-Za-z_][A-Za-z0-9_]*, for example NPM_AUTH.",
    );
  }

  const setHint = `Set ${envVar} to the full header value, for example ${envVar}="Bearer $NPM_TOKEN".`;
  const value = Object.hasOwn(env, envVar) ? env[envVar] : undefined;
  if (value === undefined) {
    fail(
      `Header ${name} for ${domain} reads ${envVar}, which is not set.`,
      setHint,
    );
  }
  if (value === "") {
    fail(
      `Header ${name} for ${domain} reads ${envVar}, which is empty.`,
      setHint,
    );
  }
  if (isMultiline(value)) {
    fail(
      `Header ${name} for ${domain} reads ${envVar}, which contains a carriage return or line feed.`,
      SINGLE_LINE_HINT,
    );
  }

  return { domain, name, value: new Redacted(value) };
}

const requestHeaderType = cmd.extendType(cmd.string, {
  displayName: "domain:header=value",
  async from(input) {
    return parseRequestHeader(input);
  },
});

const requestHeaderFromEnvType = cmd.extendType(cmd.string, {
  displayName: "domain:header=ENV_VAR",
  async from(input) {
    return parseRequestHeaderFromEnv(input);
  },
});

export const requestHeaders = cmd.multioption({
  long: "request-header",
  description: `Set an HTTP request header on outbound requests to a domain (creates a custom network policy). Format "domain:header=value". The value is everything after the "=", so it may contain ":" and "=". The value appears in the command line, where other processes on the machine can read it, so use --request-header-from-env for a secret. The domain is allowed implicitly. Add --allowed-domain '*' to keep every other domain allowed. Supports the same wildcards as --allowed-domain.`,
  type: cmd.array(requestHeaderType),
});

export const requestHeadersFromEnv = cmd.multioption({
  long: "request-header-from-env",
  description: `Like --request-header, but read the value from an environment variable, so a secret stays out of the command line. Format "domain:header=ENV_VAR".`,
  type: cmd.array(requestHeaderFromEnvType),
});

const POLICY_SHAPE_HINT = `Write the SDK's NetworkPolicy as JSON, for example {"allow":{"registry.npmjs.org":[{"match":{"method":["GET","HEAD"]},"transform":[{"headers":{"authorization":"Bearer ..."}}]}],"*":[]}}.`;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    fail(
      "--network-policy-file - reads stdin, but stdin is a terminal.",
      "Pipe the policy in, for example with a heredoc: --network-policy-file - <<EOF.",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Reads a network policy from a JSON file, or from stdin when `path` is `-`.
 * Errors name the file and the JSON path of a problem, never the content,
 * because the policy can hold credentials.
 */
export async function readNetworkPolicyFile(
  path: string,
  read: (path: string) => Promise<string> = (p) =>
    p === "-" ? readStdin() : readFile(p, "utf8"),
): Promise<NetworkPolicy> {
  const source = path === "-" ? "stdin" : path;

  let text: string;
  try {
    text = await read(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === undefined) {
      throw error;
    }
    fail(
      `Cannot read the network policy file ${source} (${code}).`,
      "Pass a readable JSON file, or - to read stdin.",
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    // Node's message quotes the input, so keep only the position.
    const message = String(error);
    const where = (/line \d+ column \d+/.exec(message) ??
      /position \d+/.exec(message))?.[0];
    fail(
      `The network policy in ${source} is not valid JSON${where ? ` (${where})` : ""}.`,
      POLICY_SHAPE_HINT,
    );
  }

  try {
    return parseNetworkPolicy(json);
  } catch (error) {
    if (error instanceof NetworkPolicyParseError) {
      fail(
        [
          `The network policy in ${source} is invalid:`,
          ...error.issues.map((issue) => `  ${issue}`),
        ].join("\n"),
        POLICY_SHAPE_HINT,
      );
    }
    throw error;
  }
}

const networkPolicyFileType = cmd.extendType(cmd.string, {
  displayName: "FILE",
  async from(path) {
    return readNetworkPolicyFile(path);
  },
});

export const networkPolicyFile = cmd.option({
  long: "network-policy-file",
  description: `Read the whole network policy from a JSON file (use - for stdin), in the SDK's NetworkPolicy shape. Use it for rules the other flags cannot express, such as a header limited to some HTTP methods. Reading the file or stdin keeps secrets out of the command line. Cannot be combined with the other network policy flags.`,
  type: cmd.optional(networkPolicyFileType),
});

export { networkPolicyMode };

export const networkPolicyArgs = {
  networkPolicy,
  allowedDomains,
  allowedCIDRs,
  deniedCIDRs,
  requestHeaders,
  requestHeadersFromEnv,
  networkPolicyFile,
} as const;

export type NetworkPolicyArgs = {
  [K in keyof typeof networkPolicyArgs]: ParsingInto<
    (typeof networkPolicyArgs)[K]
  >;
};
