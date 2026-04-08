import { registerSerializationClass } from "@workflow/core/class-serialization";
import {
  dehydrateStepReturnValue,
  hydrateStepReturnValue,
} from "@workflow/core/serialization";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SandboxMetaData,
  SandboxRouteData,
  SessionMetaData,
} from "./api-client";
import { APIClient } from "./api-client";
import { Sandbox, type SerializedSandbox } from "./sandbox";

describe("Sandbox serialization", () => {
  const mockSandboxMetadata: SandboxMetaData = {
    name: "test-sandbox",
    persistent: false,
    currentSessionId: "sess_test123",
    region: "us-east-1",
    vcpus: 1,
    memory: 2048,
    runtime: "node24",
    timeout: 300000,
    createdAt: "2023-11-14T22:13:20.000Z",
    updatedAt: "2023-11-14T22:13:22.000Z",
  } as SandboxMetaData;

  const mockSessionMetadata: SessionMetaData = {
    id: "sess_test123",
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
    networkPolicy: { mode: "allow-all" },
  } as SessionMetaData;

  const mockRoutes: SandboxRouteData[] = [
    { url: "https://test-3000.vercel.run", subdomain: "test-3000", port: 3000 },
    { url: "https://test-4000.vercel.run", subdomain: "test-4000", port: 4000 },
  ];

  const createMockSandbox = (): Sandbox => {
    const client = new APIClient({
      teamId: "team_test",
      token: "test_token",
    });

    return new Sandbox({
      client,
      sandbox: mockSandboxMetadata,
      session: mockSessionMetadata,
      routes: mockRoutes,
      projectId: "proj_test",
    });
  };

  const serializeSandbox = (sandbox: Sandbox): SerializedSandbox => {
    return Sandbox[WORKFLOW_SERIALIZE](sandbox);
  };

  const deserializeSandbox = (data: SerializedSandbox): Sandbox => {
    return Sandbox[WORKFLOW_DESERIALIZE](data);
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("WORKFLOW_SERIALIZE", () => {
    it("serializes sandbox snapshot data", () => {
      const sandbox = createMockSandbox();
      const serialized = serializeSandbox(sandbox);

      expect(serialized.metadata.id).toBe("sess_test123");
      expect(serialized.metadata.networkPolicy).toBe("allow-all");
      expect(serialized.metadata.status).toBe("running");
      expect(serialized.metadata.memory).toBe(2048);
      expect(serialized.routes).toEqual(mockRoutes);
      expect(serialized.sandboxMetadata).toEqual(mockSandboxMetadata);
      expect(serialized.projectId).toBe("proj_test");
    });

    it("returns plain JSON-serializable data", () => {
      const sandbox = createMockSandbox();
      const serialized = serializeSandbox(sandbox);

      const jsonString = JSON.stringify(serialized);
      const parsed = JSON.parse(jsonString);

      expect(parsed.metadata.id).toBe("sess_test123");
      expect(parsed.routes).toEqual(mockRoutes);
    });

    it("does not include the API client or credentials", () => {
      const sandbox = createMockSandbox();
      const serialized = serializeSandbox(sandbox);

      expect(serialized).not.toHaveProperty("client");
      expect(JSON.stringify(serialized)).not.toContain("token");
    });
  });

  describe("WORKFLOW_DESERIALIZE", () => {
    it("returns synchronously", () => {
      const sandbox = createMockSandbox();
      const serialized = serializeSandbox(sandbox);

      const result = deserializeSandbox(serialized);

      expect(result).toBeInstanceOf(Sandbox);
      expect(result).not.toBeInstanceOf(Promise);
    });

    it("reconstructs a fully usable snapshot-backed instance", () => {
      const sandbox = createMockSandbox();
      const serialized = serializeSandbox(sandbox);

      const result = deserializeSandbox(serialized);

      // Sandbox-level metadata
      expect(result.name).toBe("test-sandbox");
      expect(result.persistent).toBe(false);
      expect((result as any).projectId).toBe("proj_test");

      // Session is restored from the serialized snapshot
      const session = result.currentSession();
      expect(session.sessionId).toBe("sess_test123");
      expect(session.status).toBe("running");
      expect(session.memory).toBe(2048);
      expect(session.networkPolicy).toBe("allow-all");
      expect(result.routes).toEqual(mockRoutes);
      expect(result.domain(3000)).toBe("https://test-3000.vercel.run");
    });

    it("does not require global credentials just to deserialize and read metadata", async () => {
      vi.resetModules();
      const { Sandbox: FreshSandbox } = await import("./sandbox");

      const serializedData: SerializedSandbox = {
        metadata: {
          id: "sess_test123",
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
          networkPolicy: "allow-all",
        },
        routes: mockRoutes,
        sandboxMetadata: mockSandboxMetadata,
        projectId: "proj_test",
      };

      const deserialized = FreshSandbox[WORKFLOW_DESERIALIZE](
        serializedData,
      ) as Sandbox;

      expect(deserialized.name).toBe("test-sandbox");
      expect(deserialized.status).toBe("running");
      expect(deserialized.routes).toEqual(mockRoutes);
    });

    it("deserialized instance has no client until ensureClient() is called", async () => {
      vi.resetModules();
      const { Sandbox: FreshSandbox } = await import("./sandbox");

      const serializedData: SerializedSandbox = {
        metadata: {
          id: "sess_test123",
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
          networkPolicy: "allow-all",
        },
        routes: mockRoutes,
        sandboxMetadata: mockSandboxMetadata,
        projectId: "proj_test",
      };

      const deserialized = FreshSandbox[WORKFLOW_DESERIALIZE](
        serializedData,
      ) as Sandbox;

      // The deserialized instance has no client until an API method is called
      // (which triggers ensureClient()). Verify the internal state is null.
      expect((deserialized as any)._client).toBeNull();
    });
  });

  describe("workflow runtime integration", () => {
    it("survives a step boundary roundtrip", async () => {
      registerSerializationClass("Sandbox", Sandbox);

      const sandbox = createMockSandbox();

      const dehydrated = await dehydrateStepReturnValue(
        sandbox,
        "run_123",
        undefined,
      );
      const rehydrated = await hydrateStepReturnValue(
        dehydrated,
        "run_123",
        undefined,
      );

      expect(rehydrated).toBeInstanceOf(Sandbox);
      expect(rehydrated.name).toBe("test-sandbox");
    });

    it("preserves converted metadata through runtime pipeline", async () => {
      registerSerializationClass("Sandbox", Sandbox);

      const sandbox = createMockSandbox();

      const dehydrated = await dehydrateStepReturnValue(
        sandbox,
        "run_456",
        undefined,
      );
      const rehydrated = await hydrateStepReturnValue(
        dehydrated,
        "run_456",
        undefined,
      );

      expect(rehydrated.name).toBe("test-sandbox");
    });
  });
});
