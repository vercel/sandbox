// This file can also be imported as `@vercel/sandbox/dist/auth`, which is completely fine.
// The only valid importer of this would be the CLI as we share the same codebase.

export * from "./file.js";
export type * from "./file.js";
export * from "./oauth.js";
export type * from "./oauth.js";
export { pollForToken } from "./poll-for-token.js";
export { inferScope, selectTeams } from "./project.js";
