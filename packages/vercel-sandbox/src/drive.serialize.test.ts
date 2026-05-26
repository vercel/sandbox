import { registerSerializationClass } from "@workflow/core/class-serialization";
import {
  dehydrateStepReturnValue,
  hydrateStepReturnValue,
} from "@workflow/core/serialization";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriveMetadata } from "./api-client";
import { APIClient } from "./api-client";
import { Drive, type SerializedDrive } from "./drive";

describe("Drive serialization", () => {
  const mockDriveMetadata: DriveMetadata = {
    name: "workspace",
    projectId: "proj_test",
    maxSizeBytes: 1073741824,
    currentSessionId: "sess_test123",
    currentSandboxName: "test-sandbox",
    createdAt: 1775650621392,
    updatedAt: 1775650621393,
  };

  const createMockDrive = (
    metadata: DriveMetadata = mockDriveMetadata,
  ): Drive => {
    const client = new APIClient({
      teamId: "team_test",
      token: "test_token",
    });

    return new Drive({
      client,
      drive: metadata,
      projectId: "proj_test",
    });
  };

  const serializeDrive = (drive: Drive): SerializedDrive => {
    return Drive[WORKFLOW_SERIALIZE](drive);
  };

  const deserializeDrive = (data: SerializedDrive): Drive => {
    return Drive[WORKFLOW_DESERIALIZE](data);
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("WORKFLOW_SERIALIZE", () => {
    it("serializes drive metadata", () => {
      const drive = createMockDrive();
      const serialized = serializeDrive(drive);

      expect(serialized.drive.name).toBe("workspace");
      expect(serialized.drive.projectId).toBe("proj_test");
      expect(serialized.drive.maxSizeBytes).toBe(1073741824);
      expect(serialized.projectId).toBe("proj_test");
    });

    it("does not include the API client or credentials", () => {
      const drive = createMockDrive();
      const serialized = serializeDrive(drive);

      expect(serialized).not.toHaveProperty("client");
      expect(serialized).not.toHaveProperty("_client");
      expect(JSON.stringify(serialized)).not.toContain("token");
    });
  });

  describe("WORKFLOW_DESERIALIZE", () => {
    it("returns synchronously", () => {
      const drive = createMockDrive();
      const serialized = serializeDrive(drive);

      const result = deserializeDrive(serialized);

      expect(result).toBeInstanceOf(Drive);
      expect(result).not.toBeInstanceOf(Promise);
    });

    it("reconstructs a metadata-backed instance", () => {
      const drive = createMockDrive();
      const serialized = serializeDrive(drive);

      const result = deserializeDrive(serialized);

      expect(result.name).toBe("workspace");
      expect(result.projectId).toBe("proj_test");
      expect(result.maxSize).toBe(1073741824);
      expect(result.currentSessionId).toBe("sess_test123");
      expect(result.currentSandboxName).toBe("test-sandbox");
      expect(result.createdAt).toEqual(new Date(1775650621392));
      expect(result.updatedAt).toEqual(new Date(1775650621393));
    });

    it("does not require global credentials just to deserialize and read metadata", async () => {
      vi.resetModules();
      const { Drive: FreshDrive } = await import("./drive");

      const deserialized = FreshDrive[WORKFLOW_DESERIALIZE]({
        drive: mockDriveMetadata,
        projectId: "proj_test",
      }) as Drive;

      expect(deserialized.name).toBe("workspace");
      expect(deserialized.maxSize).toBe(1073741824);
    });

    it("deserialized instance has no client until ensureClient() is called", async () => {
      vi.resetModules();
      const { Drive: FreshDrive } = await import("./drive");

      const deserialized = FreshDrive[WORKFLOW_DESERIALIZE]({
        drive: mockDriveMetadata,
        projectId: "proj_test",
      }) as Drive;

      expect((deserialized as any)._client).toBeNull();
    });
  });

  describe("workflow runtime integration", () => {
    it("survives a step boundary roundtrip", async () => {
      registerSerializationClass("Drive", Drive);

      const drive = createMockDrive();

      const dehydrated = await dehydrateStepReturnValue(
        drive,
        "run_123",
        undefined,
      );
      const rehydrated = await hydrateStepReturnValue(
        dehydrated,
        "run_123",
        undefined,
      );

      expect(rehydrated).toBeInstanceOf(Drive);
      expect(rehydrated.name).toBe("workspace");
      expect(rehydrated.maxSize).toBe(1073741824);
    });
  });
});
