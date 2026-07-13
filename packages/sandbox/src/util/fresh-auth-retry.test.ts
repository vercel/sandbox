import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { APIError } from "@vercel/sandbox";
import { NotOk } from "@vercel/sandbox/dist/auth/index.js";

const isTokenFreshMock = vi.fn<() => boolean>();

vi.mock("../args/auth", () => ({
  isTokenFresh: () => isTokenFreshMock(),
}));

const { withFreshAuthRetry } = await import("./fresh-auth-retry");

function makeApiError(status: number): APIError<unknown> {
  return new APIError(
    new Response("", { status, statusText: "Unauthorized" }),
  );
}

function makeNotOk(statusCode: number): NotOk {
  return new NotOk({ statusCode, responseText: "no" });
}

/**
 * Await the result of a withFreshAuthRetry call that performs backoff via
 * async-retry's setTimeout. With vi.useFakeTimers active those timers don't
 * fire on their own; runAllTimersAsync drains them in parallel with the
 * awaiting test.
 */
async function awaitWithTimers<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  await vi.runAllTimersAsync();
  const result = await settled;
  if (result.ok) return result.value;
  throw result.error;
}

describe("withFreshAuthRetry", () => {
  beforeEach(() => {
    isTokenFreshMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the value on first success without retrying", async () => {
    isTokenFreshMock.mockReturnValue(true);
    const factory = vi.fn().mockResolvedValue("ok");
    await expect(awaitWithTimers(withFreshAuthRetry(factory))).resolves.toBe(
      "ok",
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("retries on 401 when token is fresh and eventually succeeds", async () => {
    isTokenFreshMock.mockReturnValue(true);
    const factory = vi
      .fn()
      .mockRejectedValueOnce(makeApiError(401))
      .mockRejectedValueOnce(makeApiError(401))
      .mockResolvedValue("ok");
    await expect(awaitWithTimers(withFreshAuthRetry(factory))).resolves.toBe(
      "ok",
    );
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it("retries on NotOk 403 from the vercel-sandbox auth layer", async () => {
    isTokenFreshMock.mockReturnValue(true);
    const factory = vi
      .fn()
      .mockRejectedValueOnce(makeNotOk(403))
      .mockResolvedValue("scope");
    await expect(awaitWithTimers(withFreshAuthRetry(factory))).resolves.toBe(
      "scope",
    );
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("throws the last 401 once retries are exhausted", async () => {
    isTokenFreshMock.mockReturnValue(true);
    const final = makeApiError(401);
    const factory = vi
      .fn()
      .mockRejectedValueOnce(makeApiError(401))
      .mockRejectedValueOnce(makeApiError(401))
      .mockRejectedValueOnce(makeApiError(401))
      .mockRejectedValue(final);
    await expect(awaitWithTimers(withFreshAuthRetry(factory))).rejects.toBe(
      final,
    );
    expect(factory).toHaveBeenCalledTimes(5);
  });

  it("does not retry auth errors when the token is not fresh", async () => {
    isTokenFreshMock.mockReturnValue(false);
    const err = makeApiError(401);
    const factory = vi.fn().mockRejectedValue(err);
    await expect(awaitWithTimers(withFreshAuthRetry(factory))).rejects.toBe(
      err,
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-auth APIError statuses even when token is fresh", async () => {
    isTokenFreshMock.mockReturnValue(true);
    const err = makeApiError(500);
    const factory = vi.fn().mockRejectedValue(err);
    await expect(awaitWithTimers(withFreshAuthRetry(factory))).rejects.toBe(
      err,
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("does not retry generic errors even when token is fresh", async () => {
    isTokenFreshMock.mockReturnValue(true);
    const err = new Error("boom");
    const factory = vi.fn().mockRejectedValue(err);
    await expect(awaitWithTimers(withFreshAuthRetry(factory))).rejects.toBe(
      err,
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
