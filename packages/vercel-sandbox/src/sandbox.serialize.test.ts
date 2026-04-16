import { registerSerializationClass } from "@workflow/core/class-serialization";
import {
  dehydrateStepReturnValue,
  hydrateStepReturnValue,
} from "@workflow/core/serialization";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SandboxMetaData, SandboxRouteData } from "./api-client";
import { APIClient } from "./api-client";
import { Sandbox, type SerializedSandbox } from "./sandbox";
import { toSandboxSnapshot } from "./utils/sandbox-snapshot";

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
    networkPolicy: { mode: "allow-all" },
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
      sandbox: toSandboxSnapshot(metadata),
      routes,
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

      expect(serialized.metadata.id).toBe("sbx_test123");
      expect(serialized.routes).toEqual(mockRoutes);
      expect(serialized.metadata.networkPolicy).toBe("allow-all");
    });

    it("returns plain JSON-serializable data", () => {
      const sandbox = createMockSandbox();
      const serialized = serializeSandbox(sandbox);

      const jsonString = JSON.stringify(serialized);
      const parsed = JSON.parse(jsonString);

      expect(parsed.metadata.id).toBe("sbx_test123");
      expect(parsed.routes).toEqual(mockRoutes);
    });

    it("does not include the API client or credentials", () => {
      const sandbox = createMockSandbox();
      const serialized = serializeSandbox(sandbox);

      expect(serialized).not.toHaveProperty("client");
      expect(JSON.stringify(serialized)).not.toContain("token");
    });

    it("serializes span-link private params", () => {
      const sandbox = new Sandbox({
        client: new APIClient({
          teamId: "team_test",
          token: "test_token",
        }),
        sandbox: toSandboxSnapshot(mockMetadata),
        routes: mockRoutes,
        spanLinkPrivateParams: {
          __spanId: "span-sandbox",
          __traceId: "trace-sandbox",
        },
      });
      const serialized = serializeSandbox(sandbox);
      expect(serialized.spanLinkPrivateParams).toEqual({
        __spanId: "span-sandbox",
        __traceId: "trace-sandbox",
      });
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

      expect(result.sandboxId).toBe("sbx_test123");
      expect(result.status).toBe("running");
      expect(result.routes).toEqual(mockRoutes);
      expect(result.networkPolicy).toBe("allow-all");
      expect(result.domain(3000)).toBe("https://test-3000.vercel.run");
    });

    it("does not require global credentials just to deserialize and read metadata", async () => {
      vi.resetModules();
      const { Sandbox: FreshSandbox } = await import("./sandbox");

      const serializedData: SerializedSandbox = {
        metadata: {
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
          networkPolicy: "allow-all",
        },
        routes: mockRoutes,
      };

      const deserialized = FreshSandbox[WORKFLOW_DESERIALIZE](
        serializedData,
      ) as Sandbox;

      expect(deserialized.sandboxId).toBe("sbx_test123");
      expect(deserialized.status).toBe("running");
      expect(deserialized.routes).toEqual(mockRoutes);
    });

    it("deserialized instance has no client until ensureClient() is called", async () => {
      vi.resetModules();
      const { Sandbox: FreshSandbox } = await import("./sandbox");

      const serializedData: SerializedSandbox = {
        metadata: {
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
          networkPolicy: "allow-all",
        },
        routes: mockRoutes,
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
      expect(rehydrated.sandboxId).toBe("sbx_test123");
      expect(rehydrated.routes).toEqual(mockRoutes);
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

      expect(rehydrated.status).toBe("running");
      expect(rehydrated.networkPolicy).toBe("allow-all");
    });
  });
});
