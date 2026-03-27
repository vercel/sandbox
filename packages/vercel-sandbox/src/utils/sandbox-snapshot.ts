import type { SessionMetaData } from "../api-client/index.js";
import type { NetworkPolicy } from "../network-policy.js";
import { fromAPINetworkPolicy } from "./network-policy.js";

export type SandboxSnapshot = Omit<SessionMetaData, "networkPolicy"> & {
  networkPolicy?: NetworkPolicy;
};

export function toSandboxSnapshot(sandbox: SessionMetaData): SandboxSnapshot {
  const { networkPolicy, ...rest } = sandbox;
  return {
    ...rest,
    networkPolicy: networkPolicy
      ? fromAPINetworkPolicy(networkPolicy)
      : undefined,
  };
}
