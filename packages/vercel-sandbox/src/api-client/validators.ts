import { z } from "zod";

export type SessionMetaData = z.infer<typeof Session>;

export const InjectionRuleValidator = z.object({
  domain: z.string(),
  // headers are only sent in requests
  headers: z.record(z.string()).optional(),
  // headerNames are returned in responses
  headerNames: z.array(z.string()).optional(),
});

export const NetworkPolicyValidator = z.union([
  z.object({ mode: z.literal("allow-all") }).passthrough(),
  z.object({ mode: z.literal("deny-all") }).passthrough(),
  z
    .object({
      mode: z.literal("custom"),
      allowedDomains: z.array(z.string()).optional(),
      allowedCIDRs: z.array(z.string()).optional(),
      deniedCIDRs: z.array(z.string()).optional(),
      injectionRules: z.array(InjectionRuleValidator).optional(),
    })
    .passthrough(),
]);

export const Session = z.object({
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
    "aborted",
    "snapshotting",
  ]),
  requestedAt: z.number(),
  startedAt: z.number().optional(),
  requestedStopAt: z.number().optional(),
  stoppedAt: z.number().optional(),
  abortedAt: z.number().optional(),
  duration: z.number().optional(),
  sourceSnapshotId: z.string().optional(),
  snapshottedAt: z.number().optional(),
  createdAt: z.number(),
  cwd: z.string(),
  updatedAt: z.number(),
  interactivePort: z.number().optional(),
  networkPolicy: NetworkPolicyValidator.optional(),
  activeCpuDurationMs: z.number().optional(),
  networkTransfer: z.object({
    ingress: z.number(),
    egress: z.number(),
  }).optional(),
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
  sourceSessionId: z.string(),
  region: z.string(),
  status: z.enum(["created", "deleted", "failed"]),
  sizeBytes: z.number(),
  expiresAt: z.number().optional(),
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
  sessionId: z.string(),
  exitCode: z.number().nullable(),
  startedAt: z.number(),
});

const CommandFinished = Command.extend({
  exitCode: z.number(),
});

export const SessionResponse = z.object({
  session: Session.passthrough(),
});

export const SessionAndRoutesResponse = SessionResponse.extend({
  routes: z.array(SandboxRoute),
});

export const SessionsResponse = z.object({
  sessions: z.array(Session.passthrough()),
  pagination: Pagination,
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

export const SnapshotsResponse = z.object({
  snapshots: z.array(Snapshot),
  pagination: Pagination,
});

export const CreateSnapshotResponse = z.object({
  snapshot: Snapshot,
  session: Session.passthrough(),
});

export const SnapshotResponse = z.object({
  snapshot: Snapshot,
});

export const Sandbox = z.object({
  name: z.string(),
  persistent: z.boolean(),
  region: z.string().optional(),
  vcpus: z.number().optional(),
  memory: z.number().optional(),
  runtime: z.string().optional(),
  timeout: z.number().optional(),
  networkPolicy: NetworkPolicyValidator.optional(),
  totalEgressBytes: z.number().optional(),
  totalIngressBytes: z.number().optional(),
  totalActiveCpuDurationMs: z.number().optional(),
  totalDurationMs: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  currentSessionId: z.string(),
  currentSnapshotId: z.string().optional(),
  status: Session.shape.status,
  cwd: z.string().optional(),
  tags: z.record(z.string()).optional(),
});

export type SandboxMetaData = z.infer<typeof Sandbox>;

export const SandboxAndSessionResponse = z.object({
  sandbox: Sandbox,
  session: Session.passthrough(),
  routes: z.array(SandboxRoute),
});

export const CursorPagination = z.object({
  count: z.number(),
  next: z.string().nullable(),
  total: z.number(),
});

export const SandboxesPaginationResponse = z.object({
  sandboxes: z.array(Sandbox),
  pagination: CursorPagination,
});

export const UpdateSandboxResponse = z.object({
  sandbox: Sandbox,
});
