import { describe, it, expect, vi, afterEach } from "vitest";
import {
  WORKFLOW_SERIALIZE,
  WORKFLOW_DESERIALIZE,
} from "@workflow/serde";
import { Sandbox, SerializedSandbox, setGlobalCredentials } from "./sandbox";
import type { SandboxMetaData, SandboxRouteData } from "./api-client";
import { APIClient } from "./api-client";

// Mock the getCredentials function
vi.mock("./utils/get-credentials", () => ({
  getCredentials: vi.fn().mockResolvedValue({
    teamId: "team_test",
    token: "test_token",
    projectId: "project_test",
  }),
}));

describe("Sandbox serialization", () => {
  const mockMetadata: SandboxMetaData = {
    id: "sbx_test123",
    memory: 2048,
    vcpus: 1,
    region: "us-east-1",
    runtime: "node24",
    timeout: 300000,
    status: "running",
    requestedAt: 1700000000000,
    startedAt: 1700000001000,
    createdAt: 1700000000000,
    cwd: "/vercel/sandbox",
    updatedAt: 1700000002000,
  };

  const mockRoutes: SandboxRouteData[] = [
    { url: "https://test-3000.vercel.run", subdomain: "test-3000", port: 3000 },
    { url: "https://test-4000.vercel.run", subdomain: "test-4000", port: 4000 },
  ];

  const createMockSandbox = (
    metadata: SandboxMetaData = mockMetadata,
    routes: SandboxRouteData[] = mockRoutes,
  ): Sandbox => {
    const client = new APIClient({
      teamId: "team_test",
      token: "test_token",
    });

    return new Sandbox({
      client,
      sandbox: metadata,
      routes,
    });
  };

  describe("WORKFLOW_SERIALIZE", () => {
    it("serializes to just the sandbox ID", () => {
      const sandbox = createMockSandbox();
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized).toEqual({ sandboxId: "sbx_test123" });
    });

    it("preserves the sandbox ID", () => {
      const sandbox = createMockSandbox();
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized.sandboxId).toBe(sandbox.sandboxId);
    });

    it("returns a plain object that can be JSON serialized", () => {
      const sandbox = createMockSandbox();
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      const jsonString = JSON.stringify(serialized);
      const parsed = JSON.parse(jsonString);

      expect(parsed.sandboxId).toBe("sbx_test123");
    });

    it("does not include the API client or credentials", () => {
      const sandbox = createMockSandbox();
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized).not.toHaveProperty("client");
      expect(serialized).not.toHaveProperty("metadata");
      expect(serialized).not.toHaveProperty("routes");
      expect(JSON.stringify(serialized)).not.toContain("token");
    });

    it("handles special characters in sandbox ID", () => {
      const metadataWithSpecialId = { ...mockMetadata, id: "sbx_test-123_abc" };
      const sandbox = createMockSandbox(metadataWithSpecialId);
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized.sandboxId).toBe("sbx_test-123_abc");
    });
  });

  describe("WORKFLOW_DESERIALIZE", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("calls Sandbox.get with the serialized sandbox ID", async () => {
      setGlobalCredentials({ token: "test_token", teamId: "team_test" });

      const mockSandbox = createMockSandbox();
      const getSpy = vi.spyOn(Sandbox, "get").mockResolvedValue(mockSandbox);

      const serializedData: SerializedSandbox = { sandboxId: "sbx_test123" };
      const result = await Sandbox[WORKFLOW_DESERIALIZE](serializedData);

      expect(getSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sandboxId: "sbx_test123" }),
      );
      expect(result).toBe(mockSandbox);
    });

    it("returns a promise", () => {
      setGlobalCredentials({ token: "test_token", teamId: "team_test" });

      vi.spyOn(Sandbox, "get").mockResolvedValue(createMockSandbox());

      const result = Sandbox[WORKFLOW_DESERIALIZE]({ sandboxId: "sbx_test123" });

      expect(result).toBeInstanceOf(Promise);
    });

    it("passes global credentials to Sandbox.get", async () => {
      setGlobalCredentials({ token: "my_token", teamId: "my_team" });

      const getSpy = vi.spyOn(Sandbox, "get").mockResolvedValue(createMockSandbox());

      await Sandbox[WORKFLOW_DESERIALIZE]({ sandboxId: "sbx_test123" });

      expect(getSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sandboxId: "sbx_test123",
          token: "my_token",
          teamId: "my_team",
        }),
      );
    });

    it("returns a fully functional Sandbox instance", async () => {
      setGlobalCredentials({ token: "test_token", teamId: "team_test" });

      const mockSandbox = createMockSandbox();
      vi.spyOn(Sandbox, "get").mockResolvedValue(mockSandbox);

      const result = await Sandbox[WORKFLOW_DESERIALIZE]({ sandboxId: "sbx_test123" });

      expect(result).toBeInstanceOf(Sandbox);
      expect(result.sandboxId).toBe("sbx_test123");
      expect(result.status).toBe("running");
      expect(result.routes).toEqual(mockRoutes);
    });
  });

  describe("roundtrip serialization", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("preserves sandboxId through roundtrip", async () => {
      setGlobalCredentials({ token: "test_token", teamId: "team_test" });

      const originalSandbox = createMockSandbox();
      vi.spyOn(Sandbox, "get").mockResolvedValue(originalSandbox);

      const serialized = Sandbox[WORKFLOW_SERIALIZE](originalSandbox);
      expect(serialized.sandboxId).toBe("sbx_test123");

      const deserialized = await Sandbox[WORKFLOW_DESERIALIZE](serialized);
      expect(deserialized.sandboxId).toBe("sbx_test123");
    });

    it("serialized data can be stored and retrieved via JSON", async () => {
      setGlobalCredentials({ token: "test_token", teamId: "team_test" });

      const originalSandbox = createMockSandbox();
      vi.spyOn(Sandbox, "get").mockResolvedValue(originalSandbox);

      const serialized = Sandbox[WORKFLOW_SERIALIZE](originalSandbox);
      const storedJson = JSON.stringify(serialized);

      const retrievedData: SerializedSandbox = JSON.parse(storedJson);
      const deserialized = await Sandbox[WORKFLOW_DESERIALIZE](retrievedData);

      expect(deserialized.sandboxId).toBe(originalSandbox.sandboxId);
    });
  });

  describe("global credentials error", () => {
    afterEach(() => {
      setGlobalCredentials({ token: "test_token", teamId: "team_test" });
    });

    it("throws a helpful error when deserializing without global credentials", async () => {
      vi.resetModules();
      const { Sandbox: FreshSandbox } = await import("./sandbox");

      const serializedData: SerializedSandbox = { sandboxId: "sbx_test123" };

      expect(() => FreshSandbox[WORKFLOW_DESERIALIZE](serializedData)).toThrowError(
        /Global credentials have not been set/,
      );
      expect(() => FreshSandbox[WORKFLOW_DESERIALIZE](serializedData)).toThrowError(
        /setGlobalCredentials/,
      );
    });

    it("does not throw when global credentials have been set", async () => {
      setGlobalCredentials({ token: "test_token", teamId: "team_test" });

      vi.spyOn(Sandbox, "get").mockResolvedValue(createMockSandbox());

      const serializedData: SerializedSandbox = { sandboxId: "sbx_test123" };

      expect(() => Sandbox[WORKFLOW_DESERIALIZE](serializedData)).not.toThrow();
    });
  });
});
