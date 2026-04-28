import { describe, it, expect, vi } from "vitest";
import { attachPaginator } from "./paginator.js";

type Page = {
  items: number[];
  pagination: { count: number; next: string | null };
};

function makePages(pages: number[][]): Page[] {
  return pages.map((items, idx) => ({
    items,
    pagination: {
      count: items.length,
      next: idx < pages.length - 1 ? `cursor-${idx + 1}` : null,
    },
  }));
}

function mockFetcher(pages: Page[]) {
  return vi.fn(async (cursor: string) => {
    const idx = Number(cursor.split("-")[1]);
    const page = pages[idx];
    if (!page) throw new Error(`no page for cursor ${cursor}`);
    return page;
  });
}

describe("attachPaginator", () => {
  it("preserves the first page fields", async () => {
    const [first] = makePages([[1, 2]]);
    const p = attachPaginator(first, {
      itemsKey: "items",
      fetchNext: async () => {
        throw new Error("should not fetch");
      },
    });
    expect(p.items).toEqual([1, 2]);
    expect(p.pagination).toEqual({ count: 2, next: null });
  });

  it("iterates items across pages via for-await", async () => {
    const pages = makePages([[1, 2], [3, 4], [5]]);
    const fetchNext = mockFetcher(pages);
    const p = attachPaginator(pages[0], {
      itemsKey: "items",
      fetchNext,
    });
    const seen: number[] = [];
    for await (const n of p) seen.push(n);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(fetchNext).toHaveBeenCalledTimes(2);
    expect(fetchNext).toHaveBeenNthCalledWith(1, "cursor-1");
    expect(fetchNext).toHaveBeenNthCalledWith(2, "cursor-2");
  });

  it("toArray materializes all items", async () => {
    const pages = makePages([[1], [2], [3]]);
    const p = attachPaginator(pages[0], {
      itemsKey: "items",
      fetchNext: mockFetcher(pages),
    });
    expect(await p.toArray()).toEqual([1, 2, 3]);
  });

  it("pages() yields full page objects", async () => {
    const pages = makePages([[1, 2], [3]]);
    const p = attachPaginator(pages[0], {
      itemsKey: "items",
      fetchNext: mockFetcher(pages),
    });
    const collected: Page[] = [];
    for await (const page of p.pages()) collected.push(page);
    expect(collected).toHaveLength(2);
    expect(collected[0].items).toEqual([1, 2]);
    expect(collected[0].pagination.next).toBe("cursor-1");
    expect(collected[1].items).toEqual([3]);
    expect(collected[1].pagination.next).toBeNull();
  });

  it("does not fetch when first page has next=null", async () => {
    const [first] = makePages([[1, 2, 3]]);
    const fetchNext = vi.fn();
    const p = attachPaginator(first, {
      itemsKey: "items",
      fetchNext,
    });
    expect(await p.toArray()).toEqual([1, 2, 3]);
    expect(fetchNext).not.toHaveBeenCalled();
  });

  it("stops iteration when signal is aborted before first yield", async () => {
    const pages = makePages([[1], [2]]);
    const controller = new AbortController();
    controller.abort();
    const p = attachPaginator(pages[0], {
      itemsKey: "items",
      fetchNext: mockFetcher(pages),
      signal: controller.signal,
    });
    await expect(p.toArray()).rejects.toThrow();
  });

  it("stops iteration when signal is aborted between pages", async () => {
    const pages = makePages([[1, 2], [3, 4], [5, 6]]);
    const controller = new AbortController();
    const fetchNext = vi.fn(async (cursor: string) => {
      if (cursor === "cursor-2") controller.abort();
      const idx = Number(cursor.split("-")[1]);
      return pages[idx];
    });

    const p = attachPaginator(pages[0], {
      itemsKey: "items",
      fetchNext,
      signal: controller.signal,
    });

    const seen: number[] = [];
    await expect(async () => {
      for await (const n of p) seen.push(n);
    }).rejects.toThrow();
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});
