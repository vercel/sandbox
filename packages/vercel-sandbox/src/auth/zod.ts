import { z } from "zod";

/**
 * A Zod codec that serializes and deserializes JSON strings.
 */
export const json = z.string().transform((jsonString: string, ctx): unknown => {
  try {
    return JSON.parse(jsonString);
  } catch (err: any) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid JSON: ${err.message}`,
    });
    return z.NEVER;
  }
});
