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
  /** API-provided error message when the response uses Vercel's standard error envelope. */
  public serverMessage?: string;
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
    const apiError = getStandardAPIError(options?.json);
    this.code = apiError?.code;
    this.serverMessage = apiError?.message;
    this.sandboxName = options?.sandboxName;
    this.sessionId = options?.sessionId;
  }
}

function getStandardAPIError(value: unknown):
  | {
      code: string;
      message: string;
    }
  | undefined {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return undefined;
  }

  const error = value.error;
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const { code, message } = error as Record<string, unknown>;
  return typeof code === "string" && typeof message === "string"
    ? { code, message }
    : undefined;
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
