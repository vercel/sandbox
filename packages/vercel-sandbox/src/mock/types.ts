/**
 * Extracts the public instance shape of a class, stripping private/protected members.
 * Used to enforce that mock classes implement the same public API as real classes.
 */
export type PublicOf<T> = { [K in keyof T]: T[K] };
