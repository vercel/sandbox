import { registerSerializationClass } from "@workflow/core/class-serialization";
import {
  dehydrateStepReturnValue,
  hydrateStepReturnValue,
} from "@workflow/core/serialization";
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from "@workflow/serde";
import { describe, expect, it } from "vitest";
import { Drive, type DriveMetadata, type SerializedDrive } from "./index.js";

describe("Drive serialization", () => {
  const mockDriveMetadata: DriveMetadata = {
    id: "drive_test123",
    name: "workspace",
    projectId: "proj_test",
    region: "sfo1",
    maxSizeBytes: 1073741824,
    currentSessionId: "sess_test123",
    currentSandboxName: "test-sandbox",
    createdAt: 1775650621392,
    updatedAt: 1775650621393,
  };

  const createMockDrive = (
    metadata: DriveMetadata = mockDriveMetadata,
  ): Drive => {
    return new Drive({
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

  describe("WORKFLOW_SERIALIZE", () => {
    it("serializes drive metadata", () => {
      const drive = createMockDrive();
      const serialized = serializeDrive(drive);

      expect(serialized.drive.id).toBe("drive_test123");
      expect(serialized.drive.name).toBe("workspace");
      expect(serialized.drive.projectId).toBe("proj_test");
      expect(serialized.drive.region).toBe("sfo1");
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
    it("preserves fork lineage through serialization", () => {
      const drive = createMockDrive({
        ...mockDriveMetadata,
        parentDriveId: "drive_parent",
        rootDriveId: "drive_root",
      });

      const result = deserializeDrive(serializeDrive(drive));

      expect(result.parentDriveId).toBe("drive_parent");
      expect(result.rootDriveId).toBe("drive_root");
    });

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

      expect(result.driveId).toBe("drive_test123");
      expect(result.name).toBe("workspace");
      expect(result.projectId).toBe("proj_test");
      expect(result.region).toBe("sfo1");
      expect(result.maxSize).toBe(1073741824);
      expect(result.currentSessionId).toBe("sess_test123");
      expect(result.currentSandboxName).toBe("test-sandbox");
      expect(result.createdAt).toEqual(new Date(1775650621392));
      expect(result.updatedAt).toEqual(new Date(1775650621393));
    });

    it("uses the default region for legacy metadata", () => {
      const legacyDriveMetadata = { ...mockDriveMetadata };
      delete (legacyDriveMetadata as Partial<DriveMetadata>).region;

      const result = deserializeDrive({
        drive: legacyDriveMetadata,
        projectId: "proj_test",
      });

      expect(result.region).toBe("iad1");
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
      expect(rehydrated.driveId).toBe("drive_test123");
      expect(rehydrated.name).toBe("workspace");
      expect(rehydrated.maxSize).toBe(1073741824);
    });
  });
});
