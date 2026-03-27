/**
 * WebSocket protocol message types matching the Go server's protocol package.
 * All messages are JSON text frames.
 */

export interface ProxyRequest {
  type: "request";
  requestId: string;
  sessionId: string;
  method: string;
  url: string;
  headers: Record<string, string[]>;
  body?: string; // base64
}

export interface ProxyResponse {
  type: "response";
  requestId: string;
  status: number;
  headers?: Record<string, string[]>;
  body?: string; // base64
}

export interface ConnectRequest {
  type: "connect";
  requestId: string;
  sessionId: string;
  host: string;
}

export interface ConnectResponse {
  type: "connect-response";
  requestId: string;
  allow: boolean;
}

export interface ReadyMessage {
  type: "ready";
}

export interface ErrorMessage {
  type: "error";
  requestId: string;
  message: string;
}

export interface RegisterMessage {
  type: "register";
  sessionIds: string[];
}

export interface UnregisterMessage {
  type: "unregister";
  sessionIds: string[];
}

export type IncomingMessage = ProxyRequest | ConnectRequest;
export type OutgoingMessage =
  | ProxyResponse
  | ConnectResponse
  | ReadyMessage
  | ErrorMessage
  | RegisterMessage
  | UnregisterMessage;

/**
 * Convert a standard Request to a ProxyResponse by calling a handler callback.
 */
export async function requestToProtocol(
  msg: ProxyRequest,
): Promise<Request> {
  const headers = new Headers();
  for (const [key, values] of Object.entries(msg.headers)) {
    for (const value of values) {
      headers.append(key, value);
    }
  }

  let body: BodyInit | undefined;
  if (msg.body) {
    body = Buffer.from(msg.body, "base64");
  }

  return new Request(msg.url, {
    method: msg.method,
    headers,
    body:
      msg.method !== "GET" && msg.method !== "HEAD" ? body : undefined,
  });
}

/**
 * Convert a Response from a callback into a ProxyResponse protocol message.
 */
export async function responseToProtocol(
  requestId: string,
  response: Response,
): Promise<ProxyResponse> {
  const headers: Record<string, string[]> = {};
  response.headers.forEach((value, key) => {
    if (!headers[key]) {
      headers[key] = [];
    }
    headers[key].push(value);
  });

  let body: string | undefined;
  const bodyBuffer = await response.arrayBuffer();
  if (bodyBuffer.byteLength > 0) {
    body = Buffer.from(bodyBuffer).toString("base64");
  }

  return {
    type: "response",
    requestId,
    status: response.status,
    headers,
    body,
  };
}
