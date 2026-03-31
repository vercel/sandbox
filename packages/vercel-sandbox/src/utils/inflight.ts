/**
 * Deduplicates concurrent async operations by key.
 *
 * If a promise for the given key already exists in the map, it is returned.
 * Otherwise `fn` is called, and the resulting promise is stored until it
 * settles (fulfills or rejects), at which point the entry is removed so
 * subsequent calls start fresh.
 *
 * The caller owns the `Map`, which controls the scope and lifetime of
 * deduplication.
 */
export function inflight<T>(
  map: Map<string, Promise<T>>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }

  const promise = fn().finally(() => {
    map.delete(key);
  });
  map.set(key, promise);

  return promise;
}
