import type { Options as RetryOptions } from "async-retry";
import { APIError } from "./api-error";
import { ZodType } from "zod";
import { array } from "../utils/array";
import { withRetry, type RequestOptions } from "./with-retry";
import { Agent } from "undici";

export interface RequestParams extends RequestInit {
  headers?: Record<string, string>;
  method?: string;
  onRetry?(error: any, options: RequestOptions): void;
  query?: Record<string, number | string | null | undefined | string[]>;
  retry?: Partial<RetryOptions>;
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
    this.fetch = withRetry(params.fetch ?? globalThis.fetch);
    this.baseUrl = params.baseUrl;
    this.debug = params.debug ?? process.env.DEBUG_FETCH === "true";
    this.token = params.token;
    this.agent = new Agent({
      bodyTimeout: 0, // disable body timeout to allow long logs streaming
    });
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
      dispatcher: this.agent,
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
 * Extract sandboxId from a sandbox API URL.
 * URLs follow the pattern: /v1/sandboxes/{sandboxId}/...
 */
function extractSandboxId(url: string): string | undefined {
  const match = url.match(/\/v1\/sandboxes\/([^/?]+)/);
  return match?.[1];
}

/**
 * Allows to read the response text and parse it as JSON casting to the given
 * type. If the response is not ok or cannot be parsed it will return error.
 *
 * @param response Response to parse.
 * @returns Parsed response or error.
 */
export async function parse<Data, ErrorData>(
  validator: ZodType<Data>,
  response: Response,
): Promise<Parsed<Data> | APIError<ErrorData>> {
  const sandboxId = extractSandboxId(response.url);

  const text = await response.text().catch((err) => {
    return new APIError<ErrorData>(response, {
      message: `Can't read response text: ${String(err)}`,
      sandboxId,
    });
  });

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
      sandboxId,
    });
  }

  if (!response.ok) {
    return new APIError<ErrorData>(response, {
      message: `Status code ${response.status} is not ok`,
      json: json as ErrorData,
      text,
      sandboxId,
    });
  }

  const validated = validator.safeParse(json);
  if (!validated.success) {
    return new APIError<ErrorData>(response, {
      message: `Response JSON is not valid: ${validated.error}`,
      json: json as ErrorData,
      text,
      sandboxId,
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
): Promise<Parsed<Data>> {
  const result = await parse<Data, ErrorData>(validator, response);
  if (result instanceof APIError) {
    throw result;
  }

  return result;
}
