/**
 * Callback that handles proxied HTTP requests.
 * Receives a standard Request and must return a Response.
 */
export type ProxyHandler = (
  request: Request,
) => Response | Promise<Response>;

/**
 * Callback that handles HTTPS CONNECT requests.
 * Receives the target host:port and returns whether to allow the tunnel.
 */
export type ConnectHandler = (host: string) => boolean | Promise<boolean>;

/**
 * Options for attaching the proxy to a sandbox.
 */
export interface AttachOptions {
  /**
   * The port on the sandbox to use for the WebSocket server.
   * Must be one of the ports exposed during sandbox creation.
   */
  wsPort: number;

  /**
   * Optional port for the HTTP proxy inside the sandbox.
   * If 0 or omitted, the server picks a free port automatically.
   */
  proxyPort?: number;

  /**
   * Enable debug logging on the Go server.
   */
  debug?: boolean;

  /**
   * AbortSignal to cancel the attach operation.
   */
  signal?: AbortSignal;
}

/**
 * Returned by `proxy.handle()`. Contains the proxy URL and a
 * ready-made `env` record for passing to `runCommand`.
 */
export interface ProxyHandle {
  /** The raw proxy URL (e.g. `http://<sessionId>:x@127.0.0.1:<port>`). */
  url: string;
  /** Env vars to spread into `runCommand({ env: { ...handle.env } })`. */
  env: {
    HTTP_PROXY: string;
    http_proxy: string;
    HTTPS_PROXY: string;
    https_proxy: string;
  };
  /** Returns the URL string (for backward compat / string coercion). */
  toString(): string;
}

/**
 * Connection info output by the Go binary on stdout.
 */
export interface ConnectionInfo {
  wsPort: number;
  proxyPort: number;
  token: string;
}
