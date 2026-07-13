let freshTokenAcquiredAt: number | undefined;

const FRESH_TOKEN_WINDOW_MS = 15_000;

export function isTokenFresh(): boolean {
  return (
    freshTokenAcquiredAt !== undefined &&
    Date.now() - freshTokenAcquiredAt < FRESH_TOKEN_WINDOW_MS
  );
}

export function markTokenAsFresh(): void {
  freshTokenAcquiredAt = Date.now();
}
