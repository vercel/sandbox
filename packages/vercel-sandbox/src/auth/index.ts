// This file can also be imported as `@vercel/sandbox/dist/auth`, which is completely fine.
// The only valid importer of this would be the CLI as we share the same codebase.

export * from "./file";
export type * from "./file";
export * from "./oauth";
export type * from "./oauth";
export { pollForToken } from "./poll-for-token";
export { inferScope, selectTeam } from "./project";
