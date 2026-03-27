import { WsProxy } from "./ws-proxy.js";
export { WsProxy };
export type {
  ProxyHandler,
  ProxyHandle,
  ConnectHandler,
  AttachOptions,
  ConnectionInfo,
} from "./types.js";
export type {
  ProxyRequest,
  ProxyResponse,
  ConnectRequest,
  ConnectResponse,
  ReadyMessage,
  ErrorMessage,
  RegisterMessage,
  UnregisterMessage,
} from "./protocol.js";

/**
 * Create a new WsProxy instance.
 *
 * @example
 * ```ts
 * import { createWsProxy } from "@vercel/http-proxy-tunnel";
 *
 * const proxy = createWsProxy();
 * await proxy.attach(sandbox, { wsPort: 5000 });
 *
 * const result = await sandbox.runCommand({
 *   cmd: "curl",
 *   args: ["-s", "http://example.com"],
 *   env: {
 *     HTTP_PROXY: proxy.handle((req) => new Response("intercepted")),
 *   },
 * });
 * ```
 */
export function createWsProxy(): WsProxy {
  return new WsProxy();
}
