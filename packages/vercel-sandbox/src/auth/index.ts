import { OAuth as createOAuth } from "../../../shared/src/auth/oauth.js";
import { sdkConfig } from "../config.js";

export * from "../../../shared/src/auth/file.js";
export { pollForToken } from "../../../shared/src/auth/poll-for-token.js";
export { inferScope } from "../../../shared/src/auth/project.js";
export { NotOk } from "../../../shared/src/auth/error.js";
export * from "../../../shared/src/auth/oauth.js";

export function OAuth() {
  return createOAuth(sdkConfig);
}
export type OAuth = Awaited<ReturnType<typeof OAuth>>;
