import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WORKFLOW_SERIALIZE,
  WORKFLOW_DESERIALIZE,
} from "@workflow/serde";
import { Sandbox, SerializedSandbox } from "./sandbox";
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
    it("serializes a sandbox instance to plain data", () => {
      const sandbox = createMockSandbox();

      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized).toEqual({
        sandboxId: "sbx_test123",
        metadata: mockMetadata,
        routes: mockRoutes,
      });
    });

    it("preserves the sandbox ID", () => {
      const sandbox = createMockSandbox();

      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized.sandboxId).toBe(sandbox.sandboxId);
    });

    it("preserves all metadata fields", () => {
      const metadataWithOptionalFields: SandboxMetaData = {
        ...mockMetadata,
        requestedStopAt: 1700000003000,
        stoppedAt: 1700000004000,
        duration: 3000,
        sourceSnapshotId: "snap_abc123",
        snapshottedAt: 1700000005000,
        interactivePort: 8080,
      };

      const sandbox = createMockSandbox(metadataWithOptionalFields);
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized.metadata).toEqual(metadataWithOptionalFields);
      expect(serialized.metadata.sourceSnapshotId).toBe("snap_abc123");
      expect(serialized.metadata.interactivePort).toBe(8080);
    });

    it("preserves route information", () => {
      const customRoutes: SandboxRouteData[] = [
        {
          url: "https://custom-8080.vercel.run",
          subdomain: "custom-8080",
          port: 8080,
        },
      ];

      const sandbox = createMockSandbox(mockMetadata, customRoutes);
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized.routes).toEqual(customRoutes);
      expect(serialized.routes).toHaveLength(1);
    });

    it("handles sandbox with empty routes", () => {
      const sandbox = createMockSandbox(mockMetadata, []);
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized.routes).toEqual([]);
    });

    it("handles sandbox with all status types", () => {
      const statuses: SandboxMetaData["status"][] = [
        "pending",
        "running",
        "stopping",
        "stopped",
        "failed",
        "snapshotting",
      ];

      for (const status of statuses) {
        const metadataWithStatus = { ...mockMetadata, status };
        const sandbox = createMockSandbox(metadataWithStatus);
        const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

        expect(serialized.metadata.status).toBe(status);
      }
    });

    it("returns a plain object that can be JSON serialized", () => {
      const sandbox = createMockSandbox();
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      const jsonString = JSON.stringify(serialized);
      const parsed = JSON.parse(jsonString);

      expect(parsed.sandboxId).toBe("sbx_test123");
      expect(parsed.metadata.id).toBe("sbx_test123");
      expect(parsed.routes).toHaveLength(2);
    });
  });

  describe("WORKFLOW_DESERIALIZE", () => {
    it("creates a Sandbox instance from serialized data", () => {
      const serializedData: SerializedSandbox = {
        sandboxId: "sbx_test123",
        metadata: mockMetadata,
        routes: mockRoutes,
      };

      const result = Sandbox[WORKFLOW_DESERIALIZE](serializedData);

      expect(result).toBeInstanceOf(Sandbox);
      expect(result.sandboxId).toBe("sbx_test123");
    });

    it("returns synchronously (not a promise)", () => {
      const serializedData: SerializedSandbox = {
        sandboxId: "sbx_test123",
        metadata: mockMetadata,
        routes: mockRoutes,
      };

      const result = Sandbox[WORKFLOW_DESERIALIZE](serializedData);

      expect(result).toBeInstanceOf(Sandbox);
      expect(result).not.toBeInstanceOf(Promise);
    });

    it("preserves sandbox properties after deserialization", () => {
      const serializedData: SerializedSandbox = {
        sandboxId: "sbx_test123",
        metadata: mockMetadata,
        routes: mockRoutes,
      };

      const result = Sandbox[WORKFLOW_DESERIALIZE](serializedData);

      expect(result.sandboxId).toBe(mockMetadata.id);
      expect(result.status).toBe(mockMetadata.status);
      expect(result.timeout).toBe(mockMetadata.timeout);
      expect(result.createdAt.getTime()).toBe(mockMetadata.createdAt);
    });

    it("preserves routes after deserialization", () => {
      const serializedData: SerializedSandbox = {
        sandboxId: "sbx_test123",
        metadata: mockMetadata,
        routes: mockRoutes,
      };

      const result = Sandbox[WORKFLOW_DESERIALIZE](serializedData);

      expect(result.routes).toEqual(mockRoutes);
      expect(result.routes[0].url).toBe("https://test-3000.vercel.run");
      expect(result.routes[1].url).toBe("https://test-4000.vercel.run");
    });

    it("deserialized instance has no client until accessed", () => {
      const serializedData: SerializedSandbox = {
        sandboxId: "sbx_test123",
        metadata: mockMetadata,
        routes: mockRoutes,
      };

      const result = Sandbox[WORKFLOW_DESERIALIZE](serializedData);

      // Client is lazily created - internal _client should be null initially
      // (accessing .client would create one using OIDC by default)
      expect((result as unknown as { _client: unknown })._client).toBeNull();
    });
  });

  describe("roundtrip serialization", () => {
    it("serializes and deserializes a sandbox", () => {
      const originalSandbox = createMockSandbox();

      // Serialize
      const serialized = Sandbox[WORKFLOW_SERIALIZE](originalSandbox);

      // Deserialize
      const deserialized = Sandbox[WORKFLOW_DESERIALIZE](serialized);

      expect(deserialized.sandboxId).toBe(originalSandbox.sandboxId);
    });

    it("preserves sandboxId through roundtrip", () => {
      const customMetadata = { ...mockMetadata, id: "sbx_custom_id_456" };
      const originalSandbox = createMockSandbox(customMetadata);

      const serialized = Sandbox[WORKFLOW_SERIALIZE](originalSandbox);
      expect(serialized.sandboxId).toBe("sbx_custom_id_456");

      const deserialized = Sandbox[WORKFLOW_DESERIALIZE](serialized);
      expect(deserialized.sandboxId).toBe("sbx_custom_id_456");
    });

    it("serialized data can be stored and retrieved via JSON", () => {
      const originalSandbox = createMockSandbox();

      // Serialize to JSON (simulating storage)
      const serialized = Sandbox[WORKFLOW_SERIALIZE](originalSandbox);
      const storedJson = JSON.stringify(serialized);

      // Retrieve from storage and deserialize
      const retrievedData: SerializedSandbox = JSON.parse(storedJson);
      const deserialized = Sandbox[WORKFLOW_DESERIALIZE](retrievedData);

      expect(deserialized.sandboxId).toBe(originalSandbox.sandboxId);
    });
  });

  describe("SerializedSandbox type", () => {
    it("contains required fields", () => {
      const serializedData: SerializedSandbox = {
        sandboxId: "sbx_test",
        metadata: mockMetadata,
        routes: mockRoutes,
      };

      expect(serializedData).toHaveProperty("sandboxId");
      expect(serializedData).toHaveProperty("metadata");
      expect(serializedData).toHaveProperty("routes");
    });

    it("metadata contains all required SandboxMetaData fields", () => {
      const sandbox = createMockSandbox();
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized.metadata).toHaveProperty("id");
      expect(serialized.metadata).toHaveProperty("memory");
      expect(serialized.metadata).toHaveProperty("vcpus");
      expect(serialized.metadata).toHaveProperty("region");
      expect(serialized.metadata).toHaveProperty("runtime");
      expect(serialized.metadata).toHaveProperty("timeout");
      expect(serialized.metadata).toHaveProperty("status");
      expect(serialized.metadata).toHaveProperty("requestedAt");
      expect(serialized.metadata).toHaveProperty("createdAt");
      expect(serialized.metadata).toHaveProperty("cwd");
      expect(serialized.metadata).toHaveProperty("updatedAt");
    });

    it("routes contain all required SandboxRouteData fields", () => {
      const sandbox = createMockSandbox();
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      for (const route of serialized.routes) {
        expect(route).toHaveProperty("url");
        expect(route).toHaveProperty("subdomain");
        expect(route).toHaveProperty("port");
      }
    });
  });

  describe("edge cases", () => {
    it("handles sandbox with minimal metadata", () => {
      const minimalMetadata: SandboxMetaData = {
        id: "sbx_minimal",
        memory: 1024,
        vcpus: 1,
        region: "us-west-2",
        runtime: "python3.13",
        timeout: 60000,
        status: "pending",
        requestedAt: Date.now(),
        createdAt: Date.now(),
        cwd: "/",
        updatedAt: Date.now(),
      };

      const sandbox = createMockSandbox(minimalMetadata, []);
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized.sandboxId).toBe("sbx_minimal");
      expect(serialized.metadata.sourceSnapshotId).toBeUndefined();
      expect(serialized.routes).toHaveLength(0);
    });

    it("handles sandbox with maximum ports (4)", () => {
      const maxRoutes: SandboxRouteData[] = [
        { url: "https://test-3000.vercel.run", subdomain: "test-3000", port: 3000 },
        { url: "https://test-3001.vercel.run", subdomain: "test-3001", port: 3001 },
        { url: "https://test-3002.vercel.run", subdomain: "test-3002", port: 3002 },
        { url: "https://test-3003.vercel.run", subdomain: "test-3003", port: 3003 },
      ];

      const sandbox = createMockSandbox(mockMetadata, maxRoutes);
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized.routes).toHaveLength(4);
    });

    it("serialization does not include the API client", () => {
      const sandbox = createMockSandbox();
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      // Ensure no client-related data is in the serialized output
      expect(serialized).not.toHaveProperty("client");
      expect(JSON.stringify(serialized)).not.toContain("token");
    });

    it("handles special characters in sandbox ID", () => {
      const metadataWithSpecialId = { ...mockMetadata, id: "sbx_test-123_abc" };
      const sandbox = createMockSandbox(metadataWithSpecialId);
      const serialized = Sandbox[WORKFLOW_SERIALIZE](sandbox);

      expect(serialized.sandboxId).toBe("sbx_test-123_abc");
    });
  });
});
