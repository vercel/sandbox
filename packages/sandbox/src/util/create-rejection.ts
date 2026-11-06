import type { APIError } from "@vercel/sandbox";
import { z } from "zod";

const knownError = z.object({
  error: z.object({
    code: z.enum([
      "bad_request",
      "unauthorized",
      "forbidden",
      "not_found",
      "rate_limit_exceeded",
      "git_credential_grant_forbidden",
      "git_credential_grant_conflict",
      "github_connection_required",
    ]),
    message: z.string().max(8192).optional(),
  }),
});

const unsupportedAction =
  /^Invalid request: `credentials\.github\[\d+\]\.actions\[\d+\]` should be equal to one of the allowed values\b/;
const genericHint =
  "Check project access and managed credential availability before retrying.";

/** Keep diagnostics useful without echoing arbitrary API bodies or error codes. */
export function describeCreationRejection(error?: APIError<unknown>) {
  if (!error) return `Sandbox creation was rejected. ${genericHint}`;

  const status = error.response.status;
  const parsed = knownError.safeParse(error.json);
  const apiCode = parsed.success ? parsed.data.error.code : undefined;
  const actionRejected =
    status === 400 &&
    apiCode === "bad_request" &&
    unsupportedAction.test(
      parsed.success ? (parsed.data.error.message ?? "") : "",
    );
  let hint = genericHint;
  if (actionRejected) {
    hint =
      "The API does not accept a requested credential action. Deploy the unified-credential backend before using these actions.";
  } else if (apiCode === "bad_request") {
    hint =
      "The API rejected the request format. Check the command arguments and backend compatibility.";
  } else if (apiCode === "git_credential_grant_forbidden") {
    hint =
      "Check project Bounds and GitHub authorization for the requested actions.";
  } else if (apiCode === "github_connection_required") {
    hint = "Connect the selected GitHub account to Vercel, then retry.";
  } else if (status === 401 || status === 403) {
    hint = "Check the token or user login for the selected project.";
  } else if (status === 429) {
    hint = "The API rate limit was reached. Wait before retrying.";
  }

  return `Sandbox creation was rejected (HTTP ${status}${apiCode ? `, ${apiCode}` : ""}). ${hint}`;
}
