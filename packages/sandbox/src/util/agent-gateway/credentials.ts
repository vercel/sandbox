import { createHash } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { gatewayKeyFingerprint } from "./policy";

export type GatewayScope = {
  token: string;
  team: string;
  project: string;
  teamSlug?: string;
};
export const credentialService = "Vercel Sandbox AI Gateway";
const Credential = z.object({
  key: z.string().min(1),
  id: z.string().optional(),
  team: z.string(),
  user: z.string(),
});
type Credential = z.infer<typeof Credential>;
const CredentialCache = Credential.extend({
  previous: z.array(Credential).optional(),
});

function missingOriginalKey(): never {
  throw new Error(
    "This sandbox requires its original Gateway key. Supply it through host AI_GATEWAY_API_KEY or save it with sandbox gateway setup. To use a different key, create a new sandbox with --ai; the existing firewall was not changed.",
  );
}

export async function managementRequest(
  scope: GatewayScope,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    const url = new URL(path, "https://api.vercel.com");
    url.searchParams.set(
      scope.team.startsWith("team_") ? "teamId" : "slug",
      scope.team,
    );
    response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${scope.token}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(
      "Unable to reach Vercel for Gateway setup. No sandbox was started.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Gateway setup requires Vercel account access (HTTP ${response.status}). Run sandbox login, or supply AI_GATEWAY_API_KEY in your local environment.`,
    );
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new Error("Vercel returned an invalid Gateway setup response.");
  }
}

function keyRecovery(boundToSandbox: boolean) {
  return boundToSandbox
    ? "Restore access or budget for the original key. If it expired or was revoked, create a new sandbox with --ai; existing sandboxes cannot switch keys."
    : "Run sandbox gateway setup to replace it.";
}

export async function validateGatewayKey(key: string, boundToSandbox = false) {
  if (!key.trim() || /[\r\n]/.test(key))
    throw new Error("The Gateway key is empty or invalid.");
  let response: Response;
  try {
    response = await fetch("https://ai-gateway.vercel.sh/v1/credits", {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(
      "Unable to validate the Gateway key. Check your connection and retry.",
    );
  }
  await response.body?.cancel();
  if (!response.ok)
    throw new Error(
      `Gateway rejected the key (HTTP ${response.status}). ${keyRecovery(boundToSandbox)}`,
    );
}

export function credentialAccount(user: string, team: string) {
  return createHash("sha256")
    .update(JSON.stringify([user, team]))
    .digest("hex");
}

async function credentialStore(account: string) {
  try {
    const { AsyncEntry } = await import("@napi-rs/keyring");
    return new AsyncEntry(credentialService, account, {
      linux: { store: "secret-service" },
    });
  } catch {
    throw new Error(
      "Secure credential storage is unavailable. Supply AI_GATEWAY_API_KEY in your local environment; the CLI will not save it as plaintext.",
    );
  }
}

async function withSetupLock<T>(
  account: string,
  action: () => Promise<T>,
): Promise<T> {
  const path = join(tmpdir(), `vercel-sandbox-gateway-${account}.lock`);
  const deadline = Date.now() + 30_000;
  let lock;
  while (!lock) {
    try {
      lock = await open(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        throw new Error("Cannot lock Gateway credential setup.");
      if (Date.now() >= deadline)
        throw new Error(
          `Another Gateway setup is active. Retry after it finishes. If it was interrupted, inspect ${path} before removing its lock.`,
        );
      await delay(250);
    }
  }
  try {
    return await action();
  } finally {
    await lock.close();
    await unlink(path);
  }
}

async function verifyStored(
  scope: GatewayScope,
  credential: Credential,
  durationMs: number,
  boundToSandbox: boolean,
) {
  if (credential.id) {
    const result = z
      .object({
        apiKey: z.object({
          teamId: z.string(),
          purpose: z.string(),
          expiresAt: z.number().nullable(),
          leakedAt: z.number().nullable(),
        }),
      })
      .safeParse(
        await managementRequest(
          scope,
          `/v1/api-keys/${encodeURIComponent(credential.id)}`,
        ),
      );
    if (!result.success)
      throw new Error(
        `Cannot verify the saved Gateway key metadata. ${keyRecovery(boundToSandbox)}`,
      );
    const key = result.data.apiKey;
    if (
      key.teamId !== scope.team ||
      key.purpose !== "ai-gateway" ||
      key.leakedAt ||
      (key.expiresAt !== null &&
        key.expiresAt < Date.now() + durationMs + 60 * 60 * 1000)
    ) {
      throw new Error(
        `The saved Gateway key is invalid or expires before the session duration plus a one-hour margin. ${keyRecovery(boundToSandbox)}`,
      );
    }
  }
  await validateGatewayKey(credential.key, boundToSandbox);
}

type ResolveOptions = {
  setup?: boolean;
  durationMs?: number;
  fingerprint?: string;
  optional?: boolean;
};
export function resolveGatewayKey(
  scope: GatewayScope,
  options: ResolveOptions & { optional: true },
): Promise<string | undefined>;
export function resolveGatewayKey(
  scope: GatewayScope,
  options?: ResolveOptions & { optional?: false },
): Promise<string>;
export async function resolveGatewayKey(
  scope: GatewayScope,
  options: ResolveOptions = {},
): Promise<string | undefined> {
  const supplied = process.env.AI_GATEWAY_API_KEY?.trim();
  if (supplied && !options.setup) {
    if (
      options.fingerprint &&
      gatewayKeyFingerprint(supplied) !== options.fingerprint
    )
      missingOriginalKey();
    await validateGatewayKey(supplied, Boolean(options.fingerprint));
    return supplied;
  }
  if (!scope.team.startsWith("team_")) {
    const team = z
      .object({ id: z.string().startsWith("team_"), slug: z.string() })
      .safeParse(
        await managementRequest(
          scope,
          `/v2/teams/${encodeURIComponent(scope.team)}`,
        ),
      );
    if (!team.success)
      throw new Error(
        "Unable to resolve the Gateway billing team. Supply its team ID with --scope.",
      );
    scope = { ...scope, team: team.data.id, teamSlug: team.data.slug };
  }
  const identity = z
    .object({ user: z.object({ id: z.string() }) })
    .safeParse(await managementRequest(scope, "/v2/user"));
  if (!identity.success)
    throw new Error(
      "Unable to identify the signed-in Vercel user for Gateway setup.",
    );
  const user = identity.data.user.id;
  const account = credentialAccount(user, scope.team);
  let store: Awaited<ReturnType<typeof credentialStore>>;
  try {
    store = await credentialStore(account);
  } catch (error) {
    if (options.optional) return undefined;
    throw error;
  }
  return withSetupLock(account, async () => {
    let stored: string | undefined;
    try {
      stored = await store.getPassword();
    } catch {
      if (options.optional && !options.fingerprint && !options.setup)
        return undefined;
      throw new Error(
        "The OS credential store is locked or unavailable. Unlock it, or supply AI_GATEWAY_API_KEY locally.",
      );
    }
    if (stored && !options.setup) {
      let data: unknown;
      try {
        data = JSON.parse(stored);
      } catch {
        throw new Error(
          "Saved Gateway credentials are invalid. Run sandbox gateway setup.",
        );
      }
      const parsed = CredentialCache.safeParse(data);
      if (
        !parsed.success ||
        parsed.data.team !== scope.team ||
        parsed.data.user !== user
      )
        throw new Error(
          "Saved Gateway credentials do not match this account. Run sandbox gateway setup.",
        );
      const selected = options.fingerprint
        ? [parsed.data, ...(parsed.data.previous ?? [])].find(
            (credential) =>
              credential.team === scope.team &&
              credential.user === user &&
              gatewayKeyFingerprint(credential.key) === options.fingerprint,
          )
        : parsed.data;
      if (!selected) missingOriginalKey();
      await verifyStored(
        scope,
        selected,
        options.durationMs ?? 24 * 60 * 60 * 1000,
        Boolean(options.fingerprint),
      );
      return selected.key;
    }
    if (options.fingerprint && !options.setup) missingOriginalKey();
    if (options.optional) return undefined;
    if (!process.stdin.isTTY || !process.stderr.isTTY)
      throw new Error(
        "Gateway setup needs a terminal. Run sandbox gateway setup once, or supply AI_GATEWAY_API_KEY locally.",
      );
    const { select, password, confirm } = await import("@inquirer/prompts");
    const source = await select(
      {
        message: `AI Gateway for ${scope.teamSlug ?? scope.team}:`,
        choices: [
          {
            name: "Create a reusable Gateway key for this team",
            value: "create",
          },
          { name: "Save an existing Gateway key", value: "existing" },
        ],
      },
      { output: process.stderr },
    );
    let credential: Credential;
    if (source === "create") {
      if (
        !(await confirm(
          {
            message:
              "Create a key with no expiry? Inference uses this team's credits and limits. You can set a budget or revoke the key in AI Gateway.",
            default: false,
          },
          { output: process.stderr },
        ))
      )
        throw new Error("Gateway setup cancelled.");
      const result = z
        .object({
          apiKeyString: z.string().min(1),
          apiKey: z.object({ id: z.string(), teamId: z.string() }),
        })
        .safeParse(
          await managementRequest(scope, "/v1/api-keys", {
            method: "POST",
            body: JSON.stringify({
              purpose: "ai-gateway",
              name: "Sandbox coding agents",
            }),
          }),
        );
      if (!result.success || result.data.apiKey.teamId !== scope.team)
        throw new Error(
          "Invalid Gateway key creation response. Check AI Gateway before retrying.",
        );
      credential = {
        key: result.data.apiKeyString,
        id: result.data.apiKey.id,
        team: scope.team,
        user,
      };
    } else {
      if (
        !(await confirm(
          {
            message: `Confirm the supplied key should pay for sandboxes in ${scope.teamSlug ?? scope.team}. Its owning team, expiry and budget are managed separately.`,
            default: false,
          },
          { output: process.stderr },
        ))
      )
        throw new Error("Gateway setup cancelled.");
      const key =
        supplied ??
        (await password(
          { message: "AI Gateway API key:" },
          { output: process.stderr },
        ));
      credential = { key: key.trim(), team: scope.team, user };
      await validateGatewayKey(credential.key);
    }
    try {
      let previous: Credential[] = [];
      if (stored) {
        try {
          const cache = CredentialCache.parse(JSON.parse(stored));
          previous = [
            Credential.parse(cache),
            ...(cache.previous ?? []),
          ].filter(
            (old, index, all) =>
              old.user === user &&
              old.team === scope.team &&
              old.key !== credential.key &&
              all.findIndex((entry) => entry.key === old.key) === index,
          );
        } catch {
          /* Explicit setup may replace an invalid cache. */
        }
      }
      await store.setPassword(
        JSON.stringify({
          ...credential,
          ...(previous.length ? { previous } : {}),
        }),
      );
    } catch {
      throw new Error(
        `Could not save the Gateway key securely.${credential.id ? ` New key ${credential.id} was created; manage it in AI Gateway before retrying.` : ""} No sandbox was started.`,
      );
    }
    process.stderr.write(
      "Gateway setup saved for this user and team. Existing keys were retained for their sandboxes and were not revoked.\n",
    );
    return credential.key;
  });
}
