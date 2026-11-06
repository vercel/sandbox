import type { TLSSocket } from "node:tls";
import { Agent, Client, Pool, buildConnector } from "undici";

/**
 * Upper bound on concurrent requests sent over one HTTP/2 connection. Matches
 * undici's default `maxConcurrentStreams`; the server's SETTINGS frame can
 * still lower the effective limit.
 */
export const H2_MAX_CONCURRENT_REQUESTS = 100;

/**
 * Creates the undici Agent used for Sandbox API traffic.
 *
 * - `keepAliveTimeout`: undici defaults to 4s. Agent workloads routinely pause
 *   for longer than that between calls (e.g. while an LLM is thinking), and
 *   the Vercel API sends no `Keep-Alive` hint, so the next request paid for a
 *   fresh TCP + TLS handshake. Keep idle sockets for 60s instead. A
 *   server-sent `Keep-Alive: timeout=N` hint still takes precedence.
 * - `allowH2`: negotiate HTTP/2 via ALPN.
 * - Multiplexing: undici treats a client as busy once it has `pipelining`
 *   requests in flight (default 1), even on an HTTP/2 connection, so `allowH2`
 *   alone still opens a new connection per concurrent request. Raising
 *   `pipelining` globally would also turn on HTTP/1.1 pipelining, and would
 *   let a burst of requests queue onto a single client that is still
 *   connecting; if that connection then falls back to HTTP/1.1 they run one
 *   at a time. So we raise it per connection, only once ALPN has negotiated
 *   `h2`, and reset it on every reconnect.
 *
 * Note that undici never multiplexes a non-idempotent request (e.g. POST)
 * alongside other in-flight requests on the same connection; those still get
 * their own connection, exactly as before.
 *
 * @param tls - Extra TLS/connect options. Intended for tests.
 */
export function createHttpAgent(
  tls?: buildConnector.BuildOptions,
  multiplex = true,
): Agent {
  return new Agent({
    bodyTimeout: 0, // disable body timeout to allow long logs streaming
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 600_000,
    allowH2: true,
    factory: (origin, agentOptions) =>
      new Pool(origin, {
        ...agentOptions,
        factory: (poolOrigin, clientOptions) =>
          createClient(poolOrigin, clientOptions, tls, multiplex),
      }),
  });
}

function createClient(
  origin: string | URL,
  options: Client.Options,
  tls: buildConnector.BuildOptions | undefined,
  multiplex: boolean,
): Client {
  const connector = buildConnector({ ...tls, allowH2: true });
  const client: Client = new Client(origin, {
    ...options,
    connect: (connectOptions, callback) =>
      connector(connectOptions, (...args) => {
        callback(...args);
        const [error, socket] = args;
        if (!error && socket) {
          // Re-evaluated on every (re)connect, so a client that reconnects
          // over HTTP/1.1 goes back to one request at a time.
          client.pipelining =
            multiplex && (socket as TLSSocket).alpnProtocol === "h2"
              ? H2_MAX_CONCURRENT_REQUESTS
              : 1;
        }
      }),
  });
  return client;
}
