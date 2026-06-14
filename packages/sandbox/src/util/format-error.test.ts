import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import { APIError, StreamError } from "@vercel/sandbox";
import {
  isApiTimeoutError,
  formatApiError,
  formatApiTimeoutError,
  formatStreamError,
  printTopLevelError,
} from "./format-error";
import { StyledError } from "../error";

function makeApiError(status: number, json?: unknown): APIError<unknown> {
  return new APIError(
    new Response("", { status, statusText: status === 400 ? "Bad Request" : "Error" }),
    { json },
  );
}

describe("isApiTimeoutError", () => {
  it("detects DOMException-style TimeoutError / AbortError", () => {
    expect(isApiTimeoutError({ name: "TimeoutError" })).toBe(true);
    expect(isApiTimeoutError({ name: "AbortError" })).toBe(true);
  });

  it("detects node ETIMEDOUT", () => {
    expect(isApiTimeoutError({ code: "ETIMEDOUT" })).toBe(true);
  });

  it("detects undici connect/headers timeouts via cause.code", () => {
    expect(isApiTimeoutError({ cause: { code: "UND_ERR_CONNECT_TIMEOUT" } })).toBe(
      true,
    );
    expect(isApiTimeoutError({ cause: { code: "UND_ERR_HEADERS_TIMEOUT" } })).toBe(
      true,
    );
  });

  it("detects the `fetch failed` TypeError wrapper", () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
    expect(isApiTimeoutError(err)).toBe(true);
  });

  it("returns false for unrelated errors and non-objects", () => {
    expect(isApiTimeoutError(new Error("boom"))).toBe(false);
    expect(isApiTimeoutError({ name: "TypeError", message: "fetch failed" })).toBe(
      false,
    );
    expect(isApiTimeoutError(undefined)).toBe(false);
    expect(isApiTimeoutError("nope")).toBe(false);
  });
});

describe("formatApiError", () => {
  it("uses the server-provided message when present", async () => {
    const styled = await formatApiError(
      makeApiError(400, { error: { message: "name already in use" } }),
    );
    expect(styled).toBeInstanceOf(StyledError);
    expect(styled.message).toContain("name already in use");
    expect(styled.message).toContain("status code: 400");
    expect(styled.message).toContain("hint:");
  });

  it("falls back to a 400 message and keeps the APIError as cause", async () => {
    const apiError = makeApiError(400);
    const styled = await formatApiError(apiError);
    expect(styled.message).toContain("the request was invalid (400)");
    expect(styled.cause).toBe(apiError);
  });
});

describe("formatApiTimeoutError / formatStreamError", () => {
  it("formats a timeout", () => {
    const styled = formatApiTimeoutError({ name: "TimeoutError" });
    expect(styled).toBeInstanceOf(StyledError);
    expect(styled.message).toContain("timed out");
  });

  it("formats a stream error with code and session", () => {
    const styled = formatStreamError(
      new StreamError("sandbox_stopped", "stream ended", "sess_123"),
    );
    expect(styled.message).toContain("sandbox_stopped");
    expect(styled.message).toContain("sess_123");
  });
});

describe("printTopLevelError", () => {
  let errorSpy: MockInstance;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function output(): string {
    return errorSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
  }

  it("prints a StyledError message verbatim", async () => {
    await printTopLevelError(new StyledError("already pretty"));
    expect(output()).toContain("already pretty");
  });

  it("routes an APIError through the pretty formatter", async () => {
    await printTopLevelError(makeApiError(400));
    expect(output()).toContain("the request was invalid (400)");
  });

  it("routes a timeout through the timeout formatter", async () => {
    await printTopLevelError({ name: "TimeoutError" });
    expect(output()).toContain("timed out");
  });

  it("prints a single line for unknown errors without the raw object", async () => {
    await printTopLevelError(new Error("boom"));
    const printed = output();
    expect(printed).toContain("boom");
    // The raw Error object is not printed unless DEBUG=sandbox:errors.
    expect(errorSpy.mock.calls.some((c) => c[0] instanceof Error)).toBe(false);
  });
});
