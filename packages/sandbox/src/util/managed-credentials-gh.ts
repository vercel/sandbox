import { z } from "zod";
import { CliError } from "./cli-error";
import { runCommand } from "./managed-credentials-command";

const ghUserSchema = z.object({
  login: z.string().min(1),
  id: z.number().int().positive().optional(),
  name: z.string().nullish(),
  email: z.string().nullish(),
});
export interface GhAccount {
  login: string;
  id?: number;
  name?: string;
  email?: string;
}
const GH_TIMEOUT_MS = 10_000;
const failure = () =>
  new CliError(
    "Could not read the active github.com account from gh. Fix gh or pass --credentials-act-as explicitly. The CLI does not fall back to another identity after a gh failure.",
    { reason: "identity_lookup_failed" },
  );

/** Reads account metadata, never a token. Failure is not a fallback signal. */
export async function readGhAccount(): Promise<GhAccount | undefined> {
  const status = await runCommand(
    "gh",
    ["auth", "status", "--hostname", "github.com"],
    GH_TIMEOUT_MS,
  );
  if (status.status === "absent") return undefined;
  if (status.status === "failed") {
    if (/not logged in|no accounts/i.test(status.stderr)) return undefined;
    throw failure();
  }
  const user = await runCommand(
    "gh",
    [
      "api",
      "user",
      "--hostname",
      "github.com",
      "--jq",
      "{login: .login, id: .id, name: .name, email: .email}",
    ],
    GH_TIMEOUT_MS,
  );
  if (user.status !== "ok") throw failure();
  let parsed: unknown;
  try {
    parsed = JSON.parse(user.stdout);
  } catch {
    throw failure();
  }
  const result = ghUserSchema.safeParse(parsed);
  if (!result.success) throw failure();
  const { login, id, name, email } = result.data;
  return {
    login,
    ...(id !== undefined ? { id } : {}),
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
  };
}
