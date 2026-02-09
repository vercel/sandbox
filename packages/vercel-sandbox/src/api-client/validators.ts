import { z } from "zod";

export type SandboxMetaData = z.infer<typeof Sandbox>;

export const NetworkPolicyValidator = z.union([
  z.object({ mode: z.literal("allow-all") }).passthrough(),
  z.object({ mode: z.literal("deny-all") }).passthrough(),
  z
    .object({
      mode: z.literal("custom"),
      allowedDomains: z.array(z.string()).optional(),
      allowedCIDRs: z.array(z.string()).optional(),
      deniedCIDRs: z.array(z.string()).optional(),
    })
    .passthrough(),
]);

export const Sandbox = z.object({
  id: z.string(),
  memory: z.number(),
  vcpus: z.number(),
  region: z.string(),
  runtime: z.string(),
  timeout: z.number(),
  status: z.enum([
    "pending",
    "running",
    "stopping",
    "stopped",
    "failed",
    "snapshotting",
  ]),
  requestedAt: z.number(),
  startedAt: z.number().optional(),
  requestedStopAt: z.number().optional(),
  stoppedAt: z.number().optional(),
  duration: z.number().optional(),
  sourceSnapshotId: z.string().optional(),
  snapshottedAt: z.number().optional(),
  createdAt: z.number(),
  cwd: z.string(),
  updatedAt: z.number(),
  interactivePort: z.number().optional(),
  networkPolicy: NetworkPolicyValidator.optional(),
});

export type SandboxRouteData = z.infer<typeof SandboxRoute>;

export const SandboxRoute = z.object({
  url: z.string(),
  subdomain: z.string(),
  port: z.number(),
});

export type SnapshotMetadata = z.infer<typeof Snapshot>;

export const Snapshot = z.object({
  id: z.string(),
  sourceSandboxId: z.string(),
  region: z.string(),
  status: z.enum(["created", "deleted", "failed"]),
  sizeBytes: z.number(),
  expiresAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const Pagination = z.object({
  /**
   * Amount of items in the current page.
   * @example 20
   */
  count: z.number(),
  /**
   * Timestamp that must be used to request the next page.
   * @example 1540095775951
   */
  next: z.number().nullable(),
  /**
   * Timestamp that must be used to request the previous page.
   * @example 1540095775951
   */
  prev: z.number().nullable(),
});

export type CommandData = z.infer<typeof Command>;

export const Command = z.object({
  id: z.string(),
  name: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  sandboxId: z.string(),
  exitCode: z.number().nullable(),
  startedAt: z.number(),
});

const CommandFinished = Command.extend({
  exitCode: z.number(),
});

export const SandboxResponse = z.object({
  sandbox: Sandbox,
});

export const SandboxAndRoutesResponse = SandboxResponse.extend({
  routes: z.array(SandboxRoute),
});

export const CommandResponse = z.object({
  command: Command,
});

export type CommandFinishedData = z.infer<typeof CommandFinishedResponse>["command"];

export const CommandFinishedResponse = z.object({
  command: CommandFinished,
});

export const EmptyResponse = z.object({});

const LogLineBase = z.object({ data: z.string() });
export const LogLineStdout = LogLineBase.extend({
  stream: z.literal("stdout"),
});
export const LogLineStderr = LogLineBase.extend({
  stream: z.literal("stderr"),
});

export const LogError = z.object({
  stream: z.literal("error"),
  data: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const LogLine = z.discriminatedUnion("stream", [
  LogLineStdout,
  LogLineStderr,
  LogError,
]);

export const SandboxesResponse = z.object({
  sandboxes: z.array(Sandbox),
  pagination: Pagination,
});

export const SnapshotsResponse = z.object({
  snapshots: z.array(Snapshot),
  pagination: Pagination,
});

export const ExtendTimeoutResponse = z.object({
  sandbox: Sandbox,
});

export const UpdateNetworkPolicyResponse = z.object({
  sandbox: Sandbox,
});

export const CreateSnapshotResponse = z.object({
  snapshot: Snapshot,
  sandbox: Sandbox,
});

export const SnapshotResponse = z.object({
  snapshot: Snapshot,
});
