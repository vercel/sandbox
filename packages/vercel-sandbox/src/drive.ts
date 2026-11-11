import { Drive } from "@vercel/drives";
import { WORKFLOW_SERIALIZE } from "@workflow/serde";

export { Drive };
export type SerializedDrive = ReturnType<
  (typeof Drive)[typeof WORKFLOW_SERIALIZE]
>;
