import { z } from "zod";

export const CursorPagination = z.object({
  count: z.number(),
  next: z.string().nullable(),
});

export const Drive = z.object({
  id: z.string(),
  parentDriveId: z.string().optional(),
  rootDriveId: z.string().optional(),
  name: z.string(),
  projectId: z.string(),
  region: z.string(),
  maxSizeBytes: z.number(),
  currentSessionId: z.string().optional(),
  currentSandboxName: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type DriveMetadata = z.infer<typeof Drive>;

export const DrivesResponse = z.object({
  drives: z.array(Drive),
  pagination: CursorPagination,
});

export const DriveResponse = z.object({
  drive: Drive,
});
