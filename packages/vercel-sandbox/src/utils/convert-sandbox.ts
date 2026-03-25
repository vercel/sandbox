import type { SandboxMetaData } from "../api-client/index.js";
import type { NetworkPolicy } from "../network-policy.js";
import { fromAPINetworkPolicy } from "./network-policy.js";

export type ConvertedSandbox = Omit<SandboxMetaData, "networkPolicy"> & {
  networkPolicy?: NetworkPolicy;
};

export function convertSandbox(sandbox: SandboxMetaData): ConvertedSandbox {
  const { networkPolicy, ...rest } = sandbox;
  return {
    ...rest,
    networkPolicy: networkPolicy
      ? fromAPINetworkPolicy(networkPolicy)
      : undefined,
  };
}
