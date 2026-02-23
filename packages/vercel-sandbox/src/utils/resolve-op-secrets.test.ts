import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveOpSecretsInEnv } from "./resolve-op-secrets";

const mockResolve = vi.fn();
const mockValidateSecretReference = vi.fn();

vi.mock("@1password/sdk", () => ({
  createClient: vi.fn().mockResolvedValue({
    secrets: { resolve: mockResolve },
  }),
  DesktopAuth: vi.fn(),
  Secrets: { validateSecretReference: mockValidateSecretReference },
}));

describe("resolveOpSecretsInEnv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue("resolved-secret");
    mockValidateSecretReference.mockReturnValue(undefined);
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
    delete process.env.OP_ACCOUNT;
  });

  it("returns env unchanged when no op:// refs", async () => {
    const env = { FOO: "plain" };
    const result = await resolveOpSecretsInEnv(env);
    expect(result).toBe(env);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("throws when refs exist but 1Password is not configured", async () => {
    const env = { MY_SECRET: "op://Vault/Item/field" };
    await expect(resolveOpSecretsInEnv(env)).rejects.toThrow(
      "1Password is not configured",
    );
    expect(mockResolve).not.toHaveBeenCalled();
    expect(env.MY_SECRET).toBe("op://Vault/Item/field");
  });

  it("resolves op:// refs when auth is set", async () => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "test-token";
    mockResolve.mockResolvedValue("the-secret");

    const result = await resolveOpSecretsInEnv({
      MY_SECRET: "op://Vault/Item/field",
      OTHER: "plain",
    });

    expect(result).toEqual({ MY_SECRET: "the-secret", OTHER: "plain" });
    expect(mockValidateSecretReference).toHaveBeenCalledWith("op://Vault/Item/field");
    expect(mockResolve).toHaveBeenCalledWith("op://Vault/Item/field");
  });

  it("resolves multiple op:// refs when auth is set", async () => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = "test-token";
    mockResolve.mockImplementation((ref: string) =>
      Promise.resolve(
        ref === "op://Vault/A/field" ? "secret-a" : "secret-b",
      ),
    );

    const result = await resolveOpSecretsInEnv({
      FIRST: "op://Vault/A/field",
      SECOND: "op://Vault/B/field",
      PLAIN: "plain-value",
    });

    expect(result).toEqual({
      FIRST: "secret-a",
      SECOND: "secret-b",
      PLAIN: "plain-value",
    });
    expect(mockValidateSecretReference).toHaveBeenCalledWith("op://Vault/A/field");
    expect(mockValidateSecretReference).toHaveBeenCalledWith("op://Vault/B/field");
    expect(mockResolve).toHaveBeenCalledWith("op://Vault/A/field");
    expect(mockResolve).toHaveBeenCalledWith("op://Vault/B/field");
  });
});
