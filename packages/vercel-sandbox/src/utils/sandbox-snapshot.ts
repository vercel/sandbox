import type { SandboxMetaData } from "../api-client";
import type { NetworkPolicy } from "../network-policy";
import { fromAPINetworkPolicy } from "./network-policy";

export type SandboxSnapshot = Omit<SandboxMetaData, "networkPolicy"> & {
  networkPolicy?: NetworkPolicy;
};

export function toSandboxSnapshot(sandbox: SandboxMetaData): SandboxSnapshot {
  const { networkPolicy, ...rest } = sandbox;
  return {
    ...rest,
    networkPolicy: networkPolicy
      ? fromAPINetworkPolicy(networkPolicy)
      : undefined,
  };
}
