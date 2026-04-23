type CursorPaginationMeta = {
  count: number;
  next: string | null;
};

type HasPagination = { pagination: CursorPaginationMeta };

type ItemOf<Page, Key extends keyof Page> = Page[Key] extends Array<infer Item>
  ? Item
  : never;

export type Paginator<Page extends HasPagination, Key extends keyof Page> =
  Page &
    AsyncIterable<ItemOf<Page, Key>> & {
      pages(): AsyncIterable<Page>;
      toArray(): Promise<ItemOf<Page, Key>[]>;
    };

type AttachPaginatorOptions<Page extends HasPagination, Key extends keyof Page> = {
  itemsKey: Key;
  fetchNext: (cursor: string) => Promise<Page>;
  signal?: AbortSignal;
};

export function attachPaginator<
  Page extends HasPagination,
  Key extends keyof Page,
>(
  firstPage: Page,
  options: AttachPaginatorOptions<Page, Key>,
): Paginator<Page, Key> {
  const { itemsKey, fetchNext, signal } = options;

  async function* iteratePages(): AsyncGenerator<Page> {
    throwIfAborted(signal);
    let page = firstPage;
    yield page;
    while (page.pagination.next !== null) {
      throwIfAborted(signal);
      page = await fetchNext(page.pagination.next);
      yield page;
    }
  }

  async function* iterateItems(): AsyncGenerator<ItemOf<Page, Key>> {
    for await (const page of iteratePages()) {
      const items = page[itemsKey] as unknown as ItemOf<Page, Key>[];
      for (const item of items) {
        throwIfAborted(signal);
        yield item;
      }
    }
  }

  const paginator = firstPage as Paginator<Page, Key>;
  paginator[Symbol.asyncIterator] = iterateItems;
  paginator.pages = iteratePages;
  paginator.toArray = async () => {
    const all: ItemOf<Page, Key>[] = [];
    for await (const item of iterateItems()) {
      all.push(item);
    }
    return all;
  };
  return paginator;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}
