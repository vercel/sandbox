export type MockPaginator<K extends string, T> = { [P in K]: T[] } & {
  pagination: { count: number; next: string | null };
  pages(): AsyncGenerator<
    { [P in K]: T[] } & { pagination: { count: number; next: string | null } }
  >;
  toArray(): Promise<T[]>;
  [Symbol.asyncIterator](): AsyncGenerator<T>;
};

export function createPaginator<K extends string, T>(
  key: K,
  items: T[],
  options?: { cursor?: string; limit?: number },
): MockPaginator<K, T> {
  const parsedCursor = Number.parseInt(options?.cursor ?? "0", 10);
  const initialOffset = Number.isFinite(parsedCursor) && parsedCursor >= 0 ? parsedCursor : 0;
  const limit = Math.max(1, (options?.limit ?? items.length) || 1);
  const pageAt = (offset: number) => {
    const pageItems = items.slice(offset, offset + limit);
    const nextOffset = offset + pageItems.length;
    return {
      items: pageItems,
      pagination: {
        count: pageItems.length,
        next: nextOffset < items.length ? String(nextOffset) : null,
      },
    };
  };
  const initialPage = pageAt(initialOffset);
  return {
    [key]: initialPage.items,
    pagination: initialPage.pagination,
    async *pages() {
      let offset = initialOffset;
      do {
        const page = pageAt(offset);
        yield { [key]: page.items, pagination: page.pagination } as { [P in K]: T[] } & {
          pagination: { count: number; next: string | null };
        };
        if (page.pagination.next === null) return;
        offset = Number.parseInt(page.pagination.next, 10);
      } while (offset < items.length);
    },
    async toArray() {
      return items.slice(initialOffset);
    },
    async *[Symbol.asyncIterator]() {
      yield* items.slice(initialOffset);
    },
  } as MockPaginator<K, T>;
}
