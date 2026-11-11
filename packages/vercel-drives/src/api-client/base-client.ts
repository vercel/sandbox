import { createResponseParser } from "../../../shared/src/api-client/base-client.js";
import { APIError } from "./api-error.js";

export { BaseClient } from "../../../shared/src/api-client/base-client.js";
export type {
  Parsed,
  RequestParams,
} from "../../../shared/src/api-client/base-client.js";
export const { parse, parseOrThrow } = createResponseParser(APIError);
