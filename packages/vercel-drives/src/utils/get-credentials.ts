import { getCredentials as resolveCredentials } from "../../../shared/src/utils/get-credentials.js";
import { sdkConfig } from "../config.js";

export type { Credentials } from "../../../shared/src/utils/get-credentials.js";
export {
  LocalOidcContextError,
  VercelOidcContextError,
} from "../../../shared/src/utils/get-credentials.js";

export function getCredentials(params?: unknown) {
  return resolveCredentials(params, sdkConfig);
}
