import type { SessionMetaData } from "../api-client/index.js";
import type { NetworkPolicy } from "../network-policy.js";
import { fromAPINetworkPolicy } from "./network-policy.js";

export type ConvertedSession = Omit<SessionMetaData, "networkPolicy"> & {
  networkPolicy?: NetworkPolicy;
};

export function convertSession(session: SessionMetaData): ConvertedSession {
  const { networkPolicy, ...rest } = session;
  return {
    ...rest,
    networkPolicy: networkPolicy
      ? fromAPINetworkPolicy(networkPolicy)
      : undefined,
  };
}
