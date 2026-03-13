import type { SessionMetaData } from "../api-client";
import type { NetworkPolicy } from "../network-policy";
import { fromAPINetworkPolicy } from "./network-policy";

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
