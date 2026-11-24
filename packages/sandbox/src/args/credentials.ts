import * as cmd from "cmd-ts";

export const CREDENTIAL_PROVIDERS = ["npm"] as const;
export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number];

function isCredentialProvider(value: string): value is CredentialProvider {
  return (CREDENTIAL_PROVIDERS as readonly string[]).includes(value);
}

export const credentialProviderListType = cmd.extendType(cmd.string, {
  displayName: "PROVIDER,...",
  async from(value) {
    const providers = [
      ...new Set(
        value
          .split(",")
          .map((provider) => provider.trim())
          .filter((provider) => provider !== ""),
      ),
    ];
    if (providers.length === 0) {
      throw new Error("Credentials cannot be empty.");
    }
    const unsupported = providers.filter(
      (provider) => !isCredentialProvider(provider),
    );
    if (unsupported.length > 0) {
      throw new Error(
        `Unsupported credentials: ${unsupported.join(", ")}. Supported: ${CREDENTIAL_PROVIDERS.join(", ")}.`,
      );
    }
    return providers.filter(isCredentialProvider);
  },
});

export const credentials = cmd.option({
  long: "credentials",
  type: cmd.optional(credentialProviderListType),
  description:
    "Comma-separated Vercel managed credentials to inject into the sandbox network policy.",
});
