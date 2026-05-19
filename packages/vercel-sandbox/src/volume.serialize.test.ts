import { registerSerializationClass } from "@workflow/core/class-serialization";
import {
  dehydrateStepReturnValue,
  hydrateStepReturnValue,
} from "@workflow/core/serialization";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VolumeMetadata } from "./api-client";
import { APIClient } from "./api-client";
import { Volume, type SerializedVolume } from "./volume";

describe("Volume serialization", () => {
  const mockVolumeMetadata: VolumeMetadata = {
    name: "workspace",
    projectId: "proj_test",
    maxSizeBytes: 1073741824,
    currentSessionId: "sess_test123",
    currentSandboxName: "test-sandbox",
    createdAt: 1775650621392,
    updatedAt: 1775650621393,
  };

  const createMockVolume = (
    metadata: VolumeMetadata = mockVolumeMetadata,
  ): Volume => {
    const client = new APIClient({
      teamId: "team_test",
      token: "test_token",
    });

    return new Volume({
      client,
      volume: metadata,
      projectId: "proj_test",
    });
  };

  const serializeVolume = (volume: Volume): SerializedVolume => {
    return Volume[WORKFLOW_SERIALIZE](volume);
  };

  const deserializeVolume = (data: SerializedVolume): Volume => {
    return Volume[WORKFLOW_DESERIALIZE](data);
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("WORKFLOW_SERIALIZE", () => {
    it("serializes volume metadata", () => {
      const volume = createMockVolume();
      const serialized = serializeVolume(volume);

      expect(serialized.volume.name).toBe("workspace");
      expect(serialized.volume.projectId).toBe("proj_test");
      expect(serialized.volume.maxSizeBytes).toBe(1073741824);
      expect(serialized.projectId).toBe("proj_test");
    });

    it("does not include the API client or credentials", () => {
      const volume = createMockVolume();
      const serialized = serializeVolume(volume);

      expect(serialized).not.toHaveProperty("client");
      expect(serialized).not.toHaveProperty("_client");
      expect(JSON.stringify(serialized)).not.toContain("token");
    });
  });

  describe("WORKFLOW_DESERIALIZE", () => {
    it("returns synchronously", () => {
      const volume = createMockVolume();
      const serialized = serializeVolume(volume);

      const result = deserializeVolume(serialized);

      expect(result).toBeInstanceOf(Volume);
      expect(result).not.toBeInstanceOf(Promise);
    });

    it("reconstructs a metadata-backed instance", () => {
      const volume = createMockVolume();
      const serialized = serializeVolume(volume);

      const result = deserializeVolume(serialized);

      expect(result.name).toBe("workspace");
      expect(result.projectId).toBe("proj_test");
      expect(result.project).toBe("proj_test");
      expect(result.maxSize).toBe(1073741824);
      expect(result.currentSessionId).toBe("sess_test123");
      expect(result.currentSandboxName).toBe("test-sandbox");
      expect(result.createdAt).toEqual(new Date(1775650621392));
      expect(result.updatedAt).toEqual(new Date(1775650621393));
    });

    it("does not require global credentials just to deserialize and read metadata", async () => {
      vi.resetModules();
      const { Volume: FreshVolume } = await import("./volume");

      const deserialized = FreshVolume[WORKFLOW_DESERIALIZE]({
        volume: mockVolumeMetadata,
        projectId: "proj_test",
      }) as Volume;

      expect(deserialized.name).toBe("workspace");
      expect(deserialized.maxSize).toBe(1073741824);
    });

    it("deserialized instance has no client until ensureClient() is called", async () => {
      vi.resetModules();
      const { Volume: FreshVolume } = await import("./volume");

      const deserialized = FreshVolume[WORKFLOW_DESERIALIZE]({
        volume: mockVolumeMetadata,
        projectId: "proj_test",
      }) as Volume;

      expect((deserialized as any)._client).toBeNull();
    });
  });

  describe("workflow runtime integration", () => {
    it("survives a step boundary roundtrip", async () => {
      registerSerializationClass("Volume", Volume);

      const volume = createMockVolume();

      const dehydrated = await dehydrateStepReturnValue(
        volume,
        "run_123",
        undefined,
      );
      const rehydrated = await hydrateStepReturnValue(
        dehydrated,
        "run_123",
        undefined,
      );

      expect(rehydrated).toBeInstanceOf(Volume);
      expect(rehydrated.name).toBe("workspace");
      expect(rehydrated.maxSize).toBe(1073741824);
    });
  });
});
