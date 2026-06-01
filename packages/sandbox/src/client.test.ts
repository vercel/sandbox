import { describe, it, expect } from "vitest";
import { APIError } from "@vercel/sandbox";
import { StyledError } from "./error";
import { toFriendlyApiError, withErrorHandling } from "./client";

/** Builds an {@link APIError} the way the SDK's `parse` does. */
function apiError(
  status: number,
  body: unknown,
  statusText = "Error",
): APIError<unknown> {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const response = new Response(text, { status, statusText });
  return new APIError(response, { json: body, text });
}

describe("toFriendlyApiError", () => {
  it("surfaces the API message for a known user-facing error", async () => {
    const error = apiError(
      400,
      {
        error: {
          code: "sandbox_timeout_invalid",
          message:
            "Failed to extend timeout: extension would exceed maximum execution timeout",
        },
      },
      "Bad Request",
    );

    const styled = await toFriendlyApiError(error);

    expect(styled).toBeInstanceOf(StyledError);
    expect(styled.cause).toBe(error);
    expect(styled.message).toContain(
      "Failed to extend timeout: extension would exceed maximum execution timeout",
    );
    expect(styled.message).toContain("status code: 400 Bad Request");
    // Known errors stay clean: no debugging breadcrumbs.
    expect(styled.message).not.toContain("requested url");
    expect(styled.message).not.toContain("full response buffer");
  });

  it("appends a login hint for authentication errors", async () => {
    const error = apiError(
      401,
      { error: { code: "unauthorized", message: "Not authorized." } },
      "Unauthorized",
    );

    const styled = await toFriendlyApiError(error);

    expect(styled.message).toContain("Not authorized.");
    expect(styled.message).toContain("sandbox login");
    expect(styled.message).not.toContain("requested url");
  });

  it("hides internal_server_error details behind a generic message", async () => {
    const error = apiError(
      500,
      {
        error: {
          code: "internal_server_error",
          message: "secret stack trace leaked from upstream",
        },
      },
      "Internal Server Error",
    );

    const styled = await toFriendlyApiError(error);

    expect(styled.message).not.toContain("secret stack trace");
    expect(styled.message).toContain("server error");
    expect(styled.message).toContain("full response buffer is stored in");
  });

  it("treats unparseable error bodies as internal", async () => {
    const error = apiError(400, { error: "gone" }, "Bad Request");

    const styled = await toFriendlyApiError(error);

    expect(styled.message).toContain("Sandbox API request failed");
    expect(styled.message).toContain("full response buffer is stored in");
  });
});

describe("withErrorHandling", () => {
  it("rethrows an APIError as a friendly StyledError", async () => {
    const error = apiError(
      400,
      { error: { code: "sandbox_stopped", message: "Sandbox is stopped." } },
      "Bad Request",
    );

    const thrown = await withErrorHandling(() =>
      Promise.reject(error),
    ).catch((e) => e);

    expect(thrown).toBeInstanceOf(StyledError);
    expect(thrown.cause).toBe(error);
    expect(thrown.message).toContain("Sandbox is stopped.");
  });

  it("passes through non-API errors untouched", async () => {
    const boom = new Error("boom");
    await expect(withErrorHandling(() => Promise.reject(boom))).rejects.toBe(
      boom,
    );
  });

  it("returns the resolved value when nothing throws", async () => {
    await expect(withErrorHandling(() => Promise.resolve(42))).resolves.toBe(
      42,
    );
  });
});
