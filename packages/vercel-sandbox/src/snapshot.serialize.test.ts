import { registerSerializationClass } from "@workflow/core/class-serialization";
import {
  dehydrateStepReturnValue,
  hydrateStepReturnValue,
} from "@workflow/core/serialization";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SnapshotMetadata } from "./api-client";
import { APIClient } from "./api-client";
import { Snapshot, type SerializedSnapshot } from "./snapshot";

describe("Snapshot serialization", () => {
  const mockSnapshotMetadata: SnapshotMetadata = {
    id: "snap_test123",
    sourceSandboxId: "sbx_source456",
    region: "iad1",
    status: "created",
    sizeBytes: 253826392,
    expiresAt: 1775737021391,
    createdAt: 1775650621392,
    updatedAt: 1775650621392,
  };

  const createMockSnapshot = (
    metadata: SnapshotMetadata = mockSnapshotMetadata,
  ): Snapshot => {
    const client = new APIClient({
      teamId: "team_test",
      token: "test_token",
    });

    return new Snapshot({
      client,
      snapshot: metadata,
    });
  };

  const serializeSnapshot = (snapshot: Snapshot): SerializedSnapshot => {
    return Snapshot[WORKFLOW_SERIALIZE](snapshot);
  };

  const deserializeSnapshot = (data: SerializedSnapshot): Snapshot => {
    return Snapshot[WORKFLOW_DESERIALIZE](data);
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("WORKFLOW_SERIALIZE", () => {
    it("serializes snapshot metadata", () => {
      const snapshot = createMockSnapshot();
      const serialized = serializeSnapshot(snapshot);

      expect(serialized.snapshot.id).toBe("snap_test123");
      expect(serialized.snapshot.sourceSandboxId).toBe("sbx_source456");
      expect(serialized.snapshot.region).toBe("iad1");
      expect(serialized.snapshot.status).toBe("created");
      expect(serialized.snapshot.sizeBytes).toBe(253826392);
    });

    it("returns plain JSON-serializable data", () => {
      const snapshot = createMockSnapshot();
      const serialized = serializeSnapshot(snapshot);

      const jsonString = JSON.stringify(serialized);
      const parsed = JSON.parse(jsonString);

      expect(parsed.snapshot.id).toBe("snap_test123");
      expect(parsed.snapshot.sourceSandboxId).toBe("sbx_source456");
    });

    it("does not include the API client or credentials", () => {
      const snapshot = createMockSnapshot();
      const serialized = serializeSnapshot(snapshot);

      expect(serialized).not.toHaveProperty("client");
      expect(serialized).not.toHaveProperty("_client");
      expect(JSON.stringify(serialized)).not.toContain("token");
    });
  });

  describe("WORKFLOW_DESERIALIZE", () => {
    it("returns synchronously", () => {
      const snapshot = createMockSnapshot();
      const serialized = serializeSnapshot(snapshot);

      const result = deserializeSnapshot(serialized);

      expect(result).toBeInstanceOf(Snapshot);
      expect(result).not.toBeInstanceOf(Promise);
    });

    it("reconstructs a fully usable metadata-backed instance", () => {
      const snapshot = createMockSnapshot();
      const serialized = serializeSnapshot(snapshot);

      const result = deserializeSnapshot(serialized);

      expect(result.snapshotId).toBe("snap_test123");
      expect(result.sourceSandboxId).toBe("sbx_source456");
      expect(result.status).toBe("created");
      expect(result.sizeBytes).toBe(253826392);
      expect(result.createdAt).toEqual(new Date(1775650621392));
      expect(result.expiresAt).toEqual(new Date(1775737021391));
    });

    it("does not require global credentials just to deserialize and read metadata", async () => {
      vi.resetModules();
      const { Snapshot: FreshSnapshot } = await import("./snapshot");

      const serializedData: SerializedSnapshot = {
        snapshot: mockSnapshotMetadata,
      };

      const deserialized = FreshSnapshot[WORKFLOW_DESERIALIZE](
        serializedData,
      ) as Snapshot;

      expect(deserialized.snapshotId).toBe("snap_test123");
      expect(deserialized.sourceSandboxId).toBe("sbx_source456");
      expect(deserialized.status).toBe("created");
    });

    it("deserialized instance has no client until ensureClient() is called", async () => {
      vi.resetModules();
      const { Snapshot: FreshSnapshot } = await import("./snapshot");

      const serializedData: SerializedSnapshot = {
        snapshot: mockSnapshotMetadata,
      };

      const deserialized = FreshSnapshot[WORKFLOW_DESERIALIZE](
        serializedData,
      ) as Snapshot;

      expect((deserialized as any)._client).toBeNull();
    });

    it("handles snapshot without expiresAt", () => {
      const metadataWithoutExpiry: SnapshotMetadata = {
        ...mockSnapshotMetadata,
        expiresAt: undefined,
      };

      const snapshot = createMockSnapshot(metadataWithoutExpiry);
      const serialized = serializeSnapshot(snapshot);
      const result = deserializeSnapshot(serialized);

      expect(result.expiresAt).toBeUndefined();
      expect(result.snapshotId).toBe("snap_test123");
    });
  });

  describe("workflow runtime integration", () => {
    it("survives a step boundary roundtrip", async () => {
      registerSerializationClass("Snapshot", Snapshot);

      const snapshot = createMockSnapshot();

      const dehydrated = await dehydrateStepReturnValue(
        snapshot,
        "run_123",
        undefined,
      );
      const rehydrated = await hydrateStepReturnValue(
        dehydrated,
        "run_123",
        undefined,
      );

      expect(rehydrated).toBeInstanceOf(Snapshot);
      expect(rehydrated.snapshotId).toBe("snap_test123");
      expect(rehydrated.sourceSandboxId).toBe("sbx_source456");
    });

    it("preserves all metadata through runtime pipeline", async () => {
      registerSerializationClass("Snapshot", Snapshot);

      const snapshot = createMockSnapshot();

      const dehydrated = await dehydrateStepReturnValue(
        snapshot,
        "run_456",
        undefined,
      );
      const rehydrated = await hydrateStepReturnValue(
        dehydrated,
        "run_456",
        undefined,
      );

      expect(rehydrated.status).toBe("created");
      expect(rehydrated.sizeBytes).toBe(253826392);
      expect(rehydrated.createdAt).toEqual(new Date(1775650621392));
    });
  });
});
