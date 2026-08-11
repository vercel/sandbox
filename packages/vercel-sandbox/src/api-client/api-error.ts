interface Options<ErrorData> {
  message?: string;
  json?: ErrorData;
  text?: string;
  sandboxName?: string;
  sessionId?: string;
}

export class APIError<ErrorData> extends Error {
  public response: Response;
  public message: string;
  public json?: ErrorData;
  public text?: string;
  /** Stable API error code when the response uses Vercel's standard error envelope. */
  public code?: string;
  public sandboxName?: string;
  public sessionId?: string;

  constructor(response: Response, options?: Options<ErrorData>) {
    super(response.statusText);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, APIError);
    }

    this.response = response;
    this.message = options?.message ?? "";
    this.json = options?.json;
    this.text = options?.text;
    this.code = getStandardAPIErrorCode(options?.json);
    this.sandboxName = options?.sandboxName;
    this.sessionId = options?.sessionId;
  }
}

function getStandardAPIErrorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return undefined;
  }

  const error = value.error;
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const { code } = error as Record<string, unknown>;
  return typeof code === "string" ? code : undefined;
}

/**
 * Error thrown when a stream error is received streaming.
 * This typically occurs when the sandbox is stopped while streaming.
 */
export class StreamError extends Error {
  public code: string;
  public sessionId: string;

  constructor(code: string, message: string, sessionId: string) {
    super(message);
    this.name = "StreamError";
    this.code = code;
    this.sessionId = sessionId;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StreamError);
    }
  }
}
