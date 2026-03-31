import { describe, it, expect, vi } from "vitest";
import { inflight } from "./inflight";

describe("inflight", () => {
  it("calls fn once and returns its value", async () => {
    const map = new Map<string, Promise<number>>();
    const fn = vi.fn().mockResolvedValue(42);

    const result = await inflight(map, "a", fn);

    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe(42);
  });

  it("deduplicates concurrent calls with the same key", async () => {
    const map = new Map<string, Promise<number>>();
    const fn = vi.fn().mockResolvedValue(42);

    const [r1, r2, r3] = await Promise.all([
      inflight(map, "a", fn),
      inflight(map, "a", fn),
      inflight(map, "a", fn),
    ]);

    expect(fn).toHaveBeenCalledOnce();
    expect(r1).toBe(42);
    expect(r2).toBe(42);
    expect(r3).toBe(42);
  });

  it("calls fn again after the previous call settles", async () => {
    const map = new Map<string, Promise<number>>();
    const fn = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    const first = await inflight(map, "a", fn);
    const second = await inflight(map, "a", fn);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  it("clears the entry on rejection", async () => {
    const map = new Map<string, Promise<number>>();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(99);

    await expect(inflight(map, "a", fn)).rejects.toThrow("boom");
    expect(map.size).toBe(0);

    const result = await inflight(map, "a", fn);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result).toBe(99);
  });
});
