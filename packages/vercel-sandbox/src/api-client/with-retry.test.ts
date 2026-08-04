import { afterEach, describe, expect, it, vi } from "vitest";
import { withRetry } from "./with-retry.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("withRetry", () => {
  it("makes two retries with randomized backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const requestTimes: number[] = [];
    const rawFetch = vi.fn(async () => {
      requestTimes.push(Date.now());
      return new Response(null, { status: 500 });
    });

    const responsePromise = withRetry(rawFetch)("https://example.com");
    await vi.runAllTimersAsync();

    await expect(responsePromise).resolves.toMatchObject({ status: 500 });
    expect(rawFetch).toHaveBeenCalledTimes(3);
    expectRetryTimes(requestTimes);
  });

  it("does not retry 429 responses with retry-after over 20 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rawFetch = vi.fn(async () => {
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    });

    const responsePromise = withRetry(rawFetch)("https://example.com");
    await vi.runAllTimersAsync();

    await expect(responsePromise).resolves.toMatchObject({ status: 429 });
    expect(rawFetch).toHaveBeenCalledTimes(1);
  });

  it("waits and retries 429 responses with retry-after of 20 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const requestTimes: number[] = [];
    const rawFetch = vi.fn(async () => {
      requestTimes.push(Date.now());
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "20" },
      });
    });

    const responsePromise = withRetry(rawFetch)("https://example.com");
    await vi.runAllTimersAsync();

    await expect(responsePromise).resolves.toMatchObject({ status: 429 });
    expect(rawFetch).toHaveBeenCalledTimes(3);
    expectRetryTimes(requestTimes, 20_000);
  });

  it("aborts while waiting to retry", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const rawFetch = vi.fn(async () => {
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "20" },
      });
    });

    const responsePromise = withRetry(rawFetch)("https://example.com", {
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(responsePromise).rejects.toMatchObject({ name: "AbortError" });
    expect(rawFetch).toHaveBeenCalledTimes(1);
  });
});

function expectRetryTimes(requestTimes: number[], retryAfter = 0) {
  expect(requestTimes[0]).toBe(0);
  expect(requestTimes[1]).toBeGreaterThanOrEqual(retryAfter + 400);
  expect(requestTimes[1]).toBeLessThanOrEqual(retryAfter + 800);

  const secondDelay = requestTimes[2] - requestTimes[1];
  expect(secondDelay).toBeGreaterThanOrEqual(retryAfter + 800);
  expect(secondDelay).toBeLessThanOrEqual(retryAfter + 1600);
}
