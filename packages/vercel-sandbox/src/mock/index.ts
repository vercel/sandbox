export { MockSandbox as Sandbox, type MockSandboxOptions } from "./sandbox.js";
export {
  MockCommand as Command,
  MockCommandFinished as CommandFinished,
  type MockCommandOptions,
} from "./command.js";
export { MockSnapshot as Snapshot } from "./snapshot.js";

export { APIError, StreamError } from "../api-client/api-error.js";

export type {
  NetworkPolicy,
  NetworkPolicyRule,
  NetworkTransformer,
} from "../network-policy.js";

import type { Sandbox as RealSandbox } from "../sandbox.js";
import type {
  Command as RealCommand,
  CommandFinished as RealCommandFinished,
} from "../command.js";
import type { Snapshot as RealSnapshot } from "../snapshot.js";
import type { MockSandbox } from "./sandbox.js";
import type { MockCommand, MockCommandFinished } from "./command.js";
import type { MockSnapshot } from "./snapshot.js";

type StablePublicKeys<T> = Exclude<keyof T, `_${string}`>;

type _AssertSandbox = StablePublicKeys<RealSandbox> extends keyof MockSandbox
  ? true
  : false;
type _AssertCommand = StablePublicKeys<RealCommand> extends keyof MockCommand
  ? true
  : false;
type _AssertCommandFinished =
  StablePublicKeys<RealCommandFinished> extends keyof MockCommandFinished
    ? true
    : false;
type _AssertSnapshot = StablePublicKeys<RealSnapshot> extends keyof MockSnapshot
  ? true
  : false;

const _s1: _AssertSandbox = true;
const _s2: _AssertCommand = true;
const _s3: _AssertCommandFinished = true;
const _s4: _AssertSnapshot = true;
