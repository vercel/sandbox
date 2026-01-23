/**
 * Utility type that extends a type to accept private parameters.
 *
 * The private parameters can then be extracted out of the object using
 * `getPrivateParams`.
 */
export type WithPrivate<T> = T & {
  [K in `__${string}`]?: unknown;
};

/**
 * Extract private parameters out of an object.
 */
export const getPrivateParams = (params?: object) => {
  const privateEntries = Object.entries(params ?? {}).filter(([k]) =>
    k.startsWith("__"),
  );
  return Object.fromEntries(privateEntries) as {
    [K in keyof typeof params as K extends `__${string}`
      ? K
      : never]: (typeof params)[K];
  };
};
