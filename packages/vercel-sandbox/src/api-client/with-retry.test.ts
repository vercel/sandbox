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

  it("uses normal backoff for 429 responses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const requestTimes: number[] = [];
    const rawFetch = vi.fn(async () => {
      requestTimes.push(Date.now());
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    });

    const responsePromise = withRetry(rawFetch)("https://example.com");
    await vi.runAllTimersAsync();

    await expect(responsePromise).resolves.toMatchObject({ status: 429 });
    expect(rawFetch).toHaveBeenCalledTimes(3);
    expectRetryTimes(requestTimes);
  });
});

function expectRetryTimes(requestTimes: number[]) {
  expect(requestTimes[0]).toBe(0);
  expect(requestTimes[1]).toBeGreaterThanOrEqual(400);
  expect(requestTimes[1]).toBeLessThanOrEqual(800);

  const secondDelay = requestTimes[2] - requestTimes[1];
  expect(secondDelay).toBeGreaterThanOrEqual(800);
  expect(secondDelay).toBeLessThanOrEqual(1600);
}
