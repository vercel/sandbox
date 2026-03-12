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
  public sandboxName?: string;
  public sessionId?: string

  constructor(response: Response, options?: Options<ErrorData>) {
    super(response.statusText);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, APIError);
    }

    this.response = response;
    this.message = options?.message ?? "";
    this.json = options?.json;
    this.text = options?.text;
    this.sandboxName = options?.sandboxName;
    this.sessionId = options?.sessionId;
  }
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
