import type { Options as RetryOptions } from "async-retry";
import { APIError } from "./api-error.js";
import { z, ZodType } from "zod";
import { array } from "../utils/array.js";
import { withRetry, type RequestOptions } from "./with-retry.js";
import { type Agent, fetch as undiciFetch } from "undici";
import { createHttpAgent } from "./http-agent.js";

export interface RequestParams extends RequestInit {
  headers?: Record<string, string>;
  method?: string;
  onRetry?(error: any, options: RequestOptions): void;
  query?: Record<string, number | string | null | undefined | string[]>;
  retry?: Partial<RetryOptions>;
}

const DEFAULT_AGENT = createHttpAgent();
// Non-idempotent requests must not queue behind long-lived GET streams.
const DEFAULT_WRITE_AGENT = createHttpAgent(undefined, false);

/**
 * The runtime's `fetch` as it was when this module loaded. Used to detect
 * whether `globalThis.fetch` has since been replaced (by a test stub, MSW,
 * an APM agent, ...), in which case we keep honoring the replacement.
 */
const INITIAL_GLOBAL_FETCH = globalThis.fetch;

/**
 * Resolves the fetch implementation used when none is injected.
 *
 * By default we use undici's own `fetch`, from the same undici version as
 * {@link DEFAULT_AGENT}. Passing a userland undici Agent to the runtime's
 * built-in `fetch` mixes two undici versions (Node's bundled one and ours),
 * which is only loosely compatible. If `globalThis.fetch` was replaced after
 * this module loaded, use the replacement so interception keeps working.
 */
function resolveDefaultFetch(): typeof globalThis.fetch {
  if (globalThis.fetch !== INITIAL_GLOBAL_FETCH) {
    return globalThis.fetch;
  }
  return undiciFetch as unknown as typeof globalThis.fetch;
}

/**
 * A base API client that provides a convenience wrapper for fetching where
 * we can pass query parameters as an object, support retries, debugging
 * and automatic authorization.
 */
export class BaseClient {
  protected token?: string;
  private fetch: ReturnType<typeof withRetry<RequestInit>>;
  private debug: boolean;
  private baseUrl: string;
  private agent: Agent;

  constructor(params: {
    debug?: boolean;
    baseUrl: string;
    token?: string;
    fetch?: typeof globalThis.fetch;
  }) {
    this.fetch = withRetry(params.fetch ?? resolveDefaultFetch());
    this.baseUrl = params.baseUrl;
    this.debug = params.debug ?? process.env.DEBUG_FETCH === "true";
    this.token = params.token;
    this.agent = DEFAULT_AGENT;
  }

  protected async request(path: string, opts?: RequestParams) {
    const url = new URL(`${this.baseUrl}${path}`);
    if (opts?.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        array(value).forEach((value) => {
          url.searchParams.append(key, value.toString());
        });
      }
    }

    const start = Date.now();
    const response = await this.fetch(url.toString(), {
      ...opts,
      body: opts?.body,
      method: opts?.method || "GET",
      headers: this.token
        ? { Authorization: `Bearer ${this.token}`, ...opts?.headers }
        : opts?.headers,
      // @ts-expect-error Node.js' and undici's Agent have different types
      dispatcher:
        !opts?.method || opts.method === "GET" || opts.method === "HEAD"
          ? this.agent
          : DEFAULT_WRITE_AGENT,
      signal: opts?.signal,
    });

    if (this.debug) {
      const duration = Date.now() - start;
      console.log(`[API] ${url} (${response.status}) ${duration}ms`);
      if (response.status === 429) {
        const retry = parseInt(response.headers.get("Retry-After") ?? "", 10);
        const hours = Math.floor(retry / 60 / 60);
        const minutes = Math.floor(retry / 60) % 60;
        const seconds = retry % 60;
        console.warn(
          `[API] ${url} Rate Limited, Retry After ${hours}h ${minutes}m ${seconds}s`,
        );
      }
    }

    return response;
  }
}

export interface Parsed<Data> {
  response: Response;
  text: string;
  json: Data;
}

/**
 * Extract sessionId from a sandbox API URL.
 */
function extractSessionId(url: string): string | undefined {
  const match = url.match(/\/v2\/sandboxes\/sessions\/([^/?]+)/);
  return match?.[1];
}

/**
 * Extract sandbox name from a sandbox API url.
 * Excludes known sub-paths like /sessions/ and /snapshots/.
 */
function extractSandboxName(url: string): string | undefined {
  const match = url.match(/\/v2\/sandboxes\/(?!sessions(?:\/|$|\?))(?!snapshots(?:\/|$|\?))([^/?]+)/);
  return match?.[1];
}

/**
 * The error body shape returned by the Sandbox API. Mirrors the shape the
 * CLI's formatApiError parses.
 */
const ErrorResponseBody = z.object({
  error: z.object({
    message: z.string(),
  }),
});

/**
 * Extract the server-provided error message from an error response body so
 * it can be surfaced in APIError.message. Returns undefined for any other
 * body shape.
 */
function extractServerMessage(json: unknown): string | undefined {
  const parsed = ErrorResponseBody.safeParse(json);
  return parsed.success ? parsed.data.error.message : undefined;
}

/**
 * Allows to read the response text and parse it as JSON casting to the given
 * type. If the response is not ok or cannot be parsed it will return error.
 *
 * @param response Response to parse.
 * @param responseText Previously read response body, if available.
 * @returns Parsed response or error.
 */
export async function parse<Data, ErrorData>(
  validator: ZodType<Data>,
  response: Response,
  responseText?: string,
): Promise<Parsed<Data> | APIError<ErrorData>> {
  const sessionId = extractSessionId(response.url);
  let sandboxName: string | undefined;
  if (!sessionId) {
    sandboxName = extractSandboxName(response.url);
  }

  const text =
    responseText ??
    (await response.text().catch((err) => {
      return new APIError<ErrorData>(response, {
        message: `Can't read response text: ${String(err)}`,
        sessionId,
        sandboxName
      });
    }));

  if (typeof text !== "string") {
    return text;
  }

  let json: Data | ErrorData;

  try {
    json = JSON.parse(text || "{}");
  } catch (error) {
    return new APIError<ErrorData>(response, {
      message: `Can't parse JSON: ${String(error)}`,
      text,
      sessionId,
      sandboxName
    });
  }

  if (!response.ok) {
    const serverMessage = extractServerMessage(json);
    return new APIError<ErrorData>(response, {
      message: serverMessage
        ? `Status code ${response.status} is not ok: ${serverMessage}`
        : `Status code ${response.status} is not ok`,
      json: json as ErrorData,
      text,
      sessionId,
      sandboxName
    });
  }

  const validated = validator.safeParse(json);
  if (!validated.success) {
    return new APIError<ErrorData>(response, {
      message: `Response JSON is not valid: ${validated.error}`,
      json: json as ErrorData,
      text,
      sessionId,
      sandboxName
    });
  }

  return {
    json: validated.data,
    response,
    text,
  };
}

export async function parseOrThrow<Data, ErrorData>(
  validator: ZodType<Data>,
  response: Response,
  responseText?: string,
): Promise<Parsed<Data>> {
  const result = await parse<Data, ErrorData>(validator, response, responseText);
  if (result instanceof APIError) {
    throw result;
  }

  return result;
}
