/**
 * Utility type that extends a type to accept private parameters.
 *
 * The private parameters can then be extracted out of the object using
 * `getPrivateParams`.
 */
export type WithPrivate<T> = T & {
  [K in `__${string}`]?: unknown;
};

const SPAN_LINK_PRIVATE_PARAM_REGEX =
  /^__(?:span|trace|baggage|datadog|dd)/i;

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

/**
 * Extract private parameters used to link traces/spans across API calls.
 */
export const getSpanLinkPrivateParams = (params?: object) => {
  const privateEntries = Object.entries(params ?? {}).filter(([k]) =>
    SPAN_LINK_PRIVATE_PARAM_REGEX.test(k),
  );
  return Object.fromEntries(privateEntries) as {
    [K in keyof typeof params as K extends `__${string}`
      ? K
      : never]: (typeof params)[K];
  };
};
