// Drop-in mock for `@vercel/sandbox`. `Sandbox` and `Snapshot` are thin
// subclasses whose statics inject the mocked `fetch`; everything else is the
// real SDK, re-exported so the public surface matches exactly.
export { Sandbox } from "./sandbox.js";
export { Snapshot } from "./snapshot.js";

// Mock-specific helpers for controlling stubbed commands.
export { setupSandbox } from "./setup.js";
export { command } from "./handlers.js";
export type {
  CommandHandler,
  CommandResponse,
  CommandHandlerContext,
  CommandMatcher,
} from "./handlers.js";

// The rest of the SDK surface, re-exported verbatim from the real package.
export {
  Session,
  SandboxUser,
  Command,
  CommandFinished,
  FileSystem,
  StreamError,
  APIError,
  defineSandboxProxy,
} from "@vercel/sandbox";
export type {
  NetworkPolicy,
  NetworkPolicyKeyValueMatcher,
  NetworkPolicyMatch,
  NetworkPolicyMatcher,
  NetworkPolicyRule,
  NetworkTransformer,
  SerializedSandbox,
  ExecutionContext,
  SerializedSnapshot,
  SnapshotTreeNodeData,
  SerializedCommand,
  SerializedCommandFinished,
  CommandOutput,
  InvalidRequestProxyHandler,
  ProxyMeta,
  ProxyHandler,
} from "@vercel/sandbox";

export type { IFileSystem } from "just-bash";
