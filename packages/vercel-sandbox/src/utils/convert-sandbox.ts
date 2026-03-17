import type { SandboxMetaData } from "../api-client";
import type { NetworkPolicy } from "../network-policy";
import { fromAPINetworkPolicy } from "./network-policy";

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
