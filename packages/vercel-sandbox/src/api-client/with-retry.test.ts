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

  it("does not retry unsafe methods on network errors", async () => {
    const rawFetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      withRetry(rawFetch)("https://example.com", { method: "POST" }),
    ).rejects.toThrow("fetch failed");
    expect(rawFetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry unsafe methods on non-503 5xx responses", async () => {
    const rawFetch = vi.fn(async () => {
      return new Response(null, { status: 500 });
    });

    await expect(
      withRetry(rawFetch)("https://example.com", { method: "POST" }),
    ).resolves.toMatchObject({ status: 500 });
    expect(rawFetch).toHaveBeenCalledTimes(1);
  });

  it("retries unsafe methods on 503 responses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const requestTimes: number[] = [];
    const rawFetch = vi.fn(async () => {
      requestTimes.push(Date.now());
      return new Response(null, { status: 503 });
    });

    const responsePromise = withRetry(rawFetch)("https://example.com", {
      method: "POST",
    });
    await vi.runAllTimersAsync();

    await expect(responsePromise).resolves.toMatchObject({ status: 503 });
    expect(rawFetch).toHaveBeenCalledTimes(3);
    expectRetryTimes(requestTimes);
  });

  it("retries unsafe methods on 429 responses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const requestTimes: number[] = [];
    const rawFetch = vi.fn(async () => {
      requestTimes.push(Date.now());
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "1" },
      });
    });

    const responsePromise = withRetry(rawFetch)("https://example.com", {
      method: "POST",
    });
    await vi.runAllTimersAsync();

    await expect(responsePromise).resolves.toMatchObject({ status: 429 });
    expect(rawFetch).toHaveBeenCalledTimes(3);
    expectRetryTimes(requestTimes, 1000);
  });

  it("still retries safe methods on network errors", async () => {
    vi.useFakeTimers();
    const rawFetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const responsePromise = withRetry(rawFetch)("https://example.com", {
      method: "GET",
    });
    // Attach catch so rejection is observed after timers flush.
    const expectation = expect(responsePromise).rejects.toThrow("fetch failed");
    await vi.runAllTimersAsync();
    await expectation;
    expect(rawFetch).toHaveBeenCalledTimes(3);
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
