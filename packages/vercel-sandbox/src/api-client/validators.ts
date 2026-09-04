import { z } from "zod";

export type SessionMetaData = z.infer<typeof Session>;

const RuleMatcherValidator = z.object({
  exact: z.string().optional(),
  startsWith: z.string().optional(),
  regex: z.string().optional(),
});

const KeyValueMatcherValidator = z.object({
  key: RuleMatcherValidator.optional(),
  value: RuleMatcherValidator.optional(),
});

const RuleMatchValidator = z.object({
  path: RuleMatcherValidator.optional(),
  method: z.array(z.string()).optional(),
  queryString: z.array(KeyValueMatcherValidator).optional(),
  headers: z.array(KeyValueMatcherValidator).optional(),
});

export const InjectionRuleValidator = z.object({
  domain: z.string(),
  // headers are only sent in requests
  headers: z.record(z.string(), z.string()).optional(),
  // headerNames are returned in responses
  headerNames: z.array(z.string()).optional(),
  match: RuleMatchValidator.optional(),
});

export const ForwardRuleValidator = z.object({
  domain: z.string(),
  forwardURL: z.string(),
  match: RuleMatchValidator.optional(),
});

export const NetworkPolicyTransformValidator = z.object({
  headers: z.record(z.string(), z.string()).optional(),
});

// Headers the proxy sets itself on a direct response. Mirrors hive's
// ValidateDirectResponse so a bad rule fails here instead of at cell start.
const PROXY_MANAGED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "transfer-encoding",
]);

// Status codes that cannot carry a body.
const BODYLESS_STATUS_CODES = new Set([204, 205, 304]);

export const NetworkPolicyDirectResponseValidator = z
  .object({
    statusCode: z.number().int().min(200).max(599),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    contentType: z.string().optional(),
  })
  .refine(({ body, contentType }) => body === undefined || contentType !== undefined, {
    message: "contentType must be provided when body is set",
  })
  .refine(({ statusCode, body }) => body === undefined || !BODYLESS_STATUS_CODES.has(statusCode), {
    message: "body is not allowed on status codes 204, 205, and 304",
  })
  .refine(
    ({ headers }) =>
      Object.keys(headers ?? {}).every(
        (name) => !PROXY_MANAGED_RESPONSE_HEADERS.has(name.toLowerCase()),
      ),
    { message: "headers cannot set proxy-managed headers" },
  )
  .refine(({ headers }) => {
    const names = Object.keys(headers ?? {}).map((name) => name.toLowerCase());
    return new Set(names).size === names.length;
  }, { message: "headers cannot contain duplicate names" });

export const NetworkPolicyRuleValidator = z
  .object({
    match: RuleMatchValidator.optional(),
    transform: z.array(NetworkPolicyTransformValidator).optional(),
    forwardURL: z.string().optional(),
    response: NetworkPolicyDirectResponseValidator.optional(),
  })
  .refine(
    ({ transform, forwardURL, response }) =>
      [transform, forwardURL, response].filter((v) => v !== undefined).length <= 1,
    { message: "only one of transform, forwardURL, or response can be used per rule" },
  )
  .refine(
    ({ transform, forwardURL, response }) =>
      transform !== undefined || forwardURL !== undefined || response !== undefined,
    { message: "transform, forwardURL, or response must be provided" },
  );

export const V2NetworkPolicyObjectValidator = z.object({
  allow: z
    .union([
      z.array(z.string()),
      z.record(z.string(), z.array(NetworkPolicyRuleValidator)),
    ])
    .optional(),
  subnets: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
});

const NetworkPolicyModeValidator = z.union([
  z.object({ mode: z.literal("allow-all") }).passthrough(),
  z.object({ mode: z.literal("deny-all") }).passthrough(),
]);

const LegacyCustomNetworkPolicyValidator = z
  .object({
    mode: z.literal("custom"),
    allowedDomains: z.array(z.string()).optional(),
    allowedCIDRs: z.array(z.string()).optional(),
    deniedCIDRs: z.array(z.string()).optional(),
    injectionRules: z.array(InjectionRuleValidator).optional(),
    forwardRules: z.array(ForwardRuleValidator).optional(),
  })
  .passthrough();

export const NetworkPolicyRequestValidator = z.union([
  NetworkPolicyModeValidator,
  V2NetworkPolicyObjectValidator.passthrough(),
]);

export const NetworkPolicyResponseValidator = z.union([
  NetworkPolicyModeValidator,
  LegacyCustomNetworkPolicyValidator,
]);

export const Session = z.object({
  id: z.string(),
  memory: z.number(),
  vcpus: z.number(),
  region: z.string(),
  runtime: z.string().optional(),
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
  networkPolicy: NetworkPolicyResponseValidator.optional(),
  activeCpuDurationMs: z.number().optional(),
  networkTransfer: z
    .object({
      ingress: z.number(),
      egress: z.number(),
    })
    .optional(),
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
  regions: z.array(z.string()).optional(),
  status: z.enum(["created", "deleted", "failed"]),
  sizeBytes: z.number(),
  expiresAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastUsedAt: z.number().optional(),
  creationMethod: z.string().optional(),
  parentId: z.string().optional(),
});

export const CursorPagination = z.object({
  count: z.number(),
  next: z.string().nullable(),
});

export type CommandData = z.infer<typeof Command>;

export const Command = z.object({
  id: z.string(),
  name: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  sessionId: z.string(),
  exitCode: z.number().nullable(),
  // optional because the duration was not preserved for older commands
  durationMs: z.number().optional(),
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

export type InteractiveSessionData = z.infer<typeof InteractiveSessionResponse>;

export const InteractiveSessionResponse = z.object({
  url: z.string(),
  token: z.string(),
});

export const SessionsResponse = z.object({
  sessions: z.array(Session.passthrough()),
  pagination: CursorPagination,
});

export const CommandResponse = z.object({
  command: Command,
});

export type CommandFinishedData = z.infer<
  typeof CommandFinishedResponse
>["command"];

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
export type LogLineData = z.infer<typeof LogLine>;
export type LogOutputLine = Exclude<LogLineData, z.infer<typeof LogError>>;

export const SnapshotsResponse = z.object({
  snapshots: z.array(Snapshot),
  pagination: CursorPagination,
});

export const SnapshotTreeNode = z.object({
  snapshot: Snapshot,
  siblings: z.array(Snapshot),
  count: z.string(),
});

export type SnapshotTreeNodeData = z.infer<typeof SnapshotTreeNode>;

export const SnapshotTreeResponse = z.object({
  snapshots: z.array(SnapshotTreeNode),
  anchor: SnapshotTreeNode.optional(),
  pagination: CursorPagination,
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
  failoverRegions: z.array(z.string()).optional(),
  vcpus: z.number().optional(),
  memory: z.number().optional(),
  runtime: z.string().optional(),
  image: z.string().optional(),
  timeout: z.number().optional(),
  networkPolicy: NetworkPolicyResponseValidator.optional(),
  totalEgressBytes: z.number().optional(),
  totalIngressBytes: z.number().optional(),
  totalActiveCpuDurationMs: z.number().optional(),
  totalDurationMs: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  expiresAt: z.number().optional(),
  currentSessionId: z.string(),
  currentSnapshotId: z.string().optional(),
  status: Session.shape.status,
  statusUpdatedAt: z.number().optional(),
  cwd: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
  snapshotExpiration: z.number().optional(),
  keepLastSnapshots: z
    .object({
      count: z.number(),
      expiration: z.number().optional(),
      deleteEvicted: z.boolean().optional(),
    })
    .optional(),
});

export type SandboxMetaData = z.infer<typeof Sandbox>;

export const StopSessionResponse = z.object({
  session: Session.passthrough(),
  sandbox: Sandbox.optional(),
  snapshot: Snapshot.optional(),
});

export const SandboxAndSessionResponse = z.object({
  sandbox: Sandbox,
  session: Session.passthrough(),
  routes: z.array(SandboxRoute),
  resumed: z.boolean().optional(),
});

export const SandboxesPaginationResponse = z.object({
  sandboxes: z.array(Sandbox),
  pagination: CursorPagination,
});

export const UpdateSandboxResponse = z.object({
  sandbox: Sandbox,
  routes: z.array(SandboxRoute).optional(),
});
