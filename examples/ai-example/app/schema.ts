import { z } from "zod";

export const formSchema = z.object({
  prompt: z.string(),
});

export type FormData = z.infer<typeof formSchema>;
