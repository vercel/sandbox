import type { Sandbox } from "./sandbox.js";

type Credentials = NonNullable<
  NonNullable<Parameters<typeof Sandbox.create>[0]>["credentials"]
>;
type Accepts<T> = T extends Credentials ? true : false;
type Assert<T extends true> = T;

export type ManagedCredentialTypeChecks = [
  Assert<Accepts<{ npm: true }>>,
  Assert<Accepts<{ github: [] }>>,
  Assert<Accepts<{ npm: true; github: [] }>>,
  Assert<Accepts<{}> extends false ? true : false>,
  Assert<Accepts<{ npm: false }> extends false ? true : false>,
  Assert<Accepts<{ npm: string }> extends false ? true : false>,
];
