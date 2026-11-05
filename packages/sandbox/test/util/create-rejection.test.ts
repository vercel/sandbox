import { APIError } from "@vercel/sandbox";
import { expect, test } from "vitest";
import { describeCreationRejection } from "../../src/util/create-rejection";

function apiError(status: number, json: unknown) {
  return new APIError(
    new Response(null, { status, statusText: "private-status-canary" }),
    {
      json,
      message: "private-error-canary",
      text: "private-response-canary",
    },
  );
}

test("recognizes action-schema incompatibility without copying the remote text", () => {
  const result = describeCreationRejection(
    apiError(400, {
      error: {
        code: "bad_request",
        message:
          'Invalid request: `credentials.github[0].actions[1]` should be equal to one of the allowed values "private-response-canary".',
      },
    }),
  );
  expect(result.message).toContain("HTTP 400, bad_request");
  expect(result.message).toContain("unified-credential backend");
  expect(result.data).toEqual({
    status: 400,
    apiCode: "bad_request",
    apiReason: "unsupported_credential_action",
  });
  expect(JSON.stringify(result)).not.toContain("private-");
});

test.each([
  null,
  [],
  { error: "private-response-canary" },
  {
    error: { code: "private-code-canary", message: "private-response-canary" },
  },
])("unrecognized error data stays private: %j", (body) => {
  const result = describeCreationRejection(apiError(400, body));
  expect(result.message).toContain("HTTP 400");
  expect(result.data).toEqual({ status: 400 });
  expect(JSON.stringify(result)).not.toContain("private-");
});

test("does not classify unrelated bad-request messages as action incompatibility", () => {
  const result = describeCreationRejection(
    apiError(400, {
      error: { code: "bad_request", message: "private-response-canary" },
    }),
  );
  expect(result.data).toEqual({ status: 400, apiCode: "bad_request" });
  expect(result.message).toContain("request format");
  expect(JSON.stringify(result)).not.toContain("private-");
});

test("policy failures retain only a recognized code and static recovery text", () => {
  const result = describeCreationRejection(
    apiError(403, {
      error: {
        code: "git_credential_grant_forbidden",
        message: "private-response-canary",
      },
    }),
  );
  expect(result.message).toContain("HTTP 403, git_credential_grant_forbidden");
  expect(result.message).toContain("Bounds");
  expect(result.data).toEqual({
    status: 403,
    apiCode: "git_credential_grant_forbidden",
  });
  expect(JSON.stringify(result)).not.toContain("private-");
});

test("preserves the generic fallback when no API response exists", () => {
  expect(describeCreationRejection()).toEqual({
    message:
      "Sandbox creation was rejected. Check project access and managed credential availability before retrying.",
    data: {},
  });
});
