import { generateText } from "ai";

export async function generateCode(prompt: string) {
  "use step";
  console.log("[AI] Generating code for:", prompt);

  const { text } = await generateText({
    model: "openai/gpt-4o-mini",
    system: `You are an expert Node.js programmer. Generate a complete, self-contained Node.js script that accomplishes the user's request. Output ONLY the code, no markdown fences or explanations. The code should print its results to stdout.`,
    prompt,
  });

  return text;
}

export async function fixCode(prompt: string, code: string, error: string) {
  "use step";
  console.log("[AI] Fixing code, error was:", error);

  const { text } = await generateText({
    model: "openai/gpt-4o-mini",
    system: `You are an expert Node.js programmer. Fix the code below based on the error. Output ONLY the corrected code, no markdown fences or explanations.`,
    prompt: `Original request: ${prompt}

Code that failed:
${code}

Error:
${error}`,
  });

  return text;
}
