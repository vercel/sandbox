export type PublicKey<K> = K extends `_${string}` ? never : K;
export type PublicShape<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => PublicShape<R>
  : T extends Promise<infer U>
    ? Promise<PublicShape<U>>
    : T extends object
      ? { [K in keyof T as PublicKey<K & string>]: PublicShape<T[K]> }
      : T;

/** The public static side of a class, excluding its instance prototype. */
export type PublicStaticShape<T> = Omit<PublicShape<T>, "prototype">;

/** The public runtime exports of a module, including class statics and prototypes. */
export type PublicModuleShape<T> = PublicShape<T>;

export type AssertExtends<_M extends _R, _R> = never;
