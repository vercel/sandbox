export { MockSandbox as Sandbox, type MockSandboxOptions } from "./sandbox.js";
export { setupSandbox, type SandboxServer } from "./sandbox.js";
export {
  MockCommand as Command,
  MockCommandFinished as CommandFinished,
  type MockCommandOptions,
} from "./command.js";
export { MockSnapshot as Snapshot } from "./snapshot.js";
export { command } from "./handlers.js";
export type {
  CommandHandler,
  CommandResponse,
} from "./handlers.js";

export type { IFileSystem } from "just-bash";

export { APIError, StreamError } from "../api-client/api-error.js";

export type {
  NetworkPolicy,
  NetworkPolicyRule,
  NetworkTransformer,
} from "../network-policy.js";

// Compile-time parity: errors if the mock is missing a public method or property from the real SDK.
import type { Sandbox, Command, CommandFinished, Snapshot } from "../index.js";
import type { MockSandbox } from "./sandbox.js";
import type { MockCommand, MockCommandFinished } from "./command.js";
import type { MockSnapshot } from "./snapshot.js";

type PublicKey<K> = K extends `_${string}` ? never : K;
type PublicShape<T> =
  T extends (...args: infer A) => infer R ? (...args: A) => PublicShape<R> :
  T extends Promise<infer U> ? Promise<PublicShape<U>> :
  T extends object ? { [K in keyof T as PublicKey<K & string>]: PublicShape<T[K]> } :
  T;

type _Sandbox = AssertExtends<PublicShape<MockSandbox>, PublicShape<Sandbox>>;
type _Command = AssertExtends<PublicShape<MockCommand>, PublicShape<Command>>;
type _CommandFinished = AssertExtends<PublicShape<MockCommandFinished>, PublicShape<CommandFinished>>;
type _Snapshot = AssertExtends<PublicShape<MockSnapshot>, PublicShape<Snapshot>>;
type AssertExtends<_M extends _R, _R> = never;
