import { FatalError } from "workflow";
import { createSandbox, execute, stopSandbox } from "@/steps/sandbox";
import { generateCode, fixCode } from "@/steps/ai";

const MAX_ATTEMPTS = 3;

export async function runCode(prompt: string) {
  "use workflow";

  // Step 1: Create a sandbox.
  // The returned Sandbox instance is automatically serialized via
  // WORKFLOW_SERIALIZE when it crosses the step boundary.
  const sandbox = await createSandbox();

  try {
    let code = await generateCode(prompt);
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (lastError) {
        code = await fixCode(prompt, code, lastError);
      }

      // The sandbox object survives the step boundary from createSandbox —
      // it was rehydrated via WORKFLOW_DESERIALIZE, no Sandbox.get() needed.
      const result = await execute(sandbox, code);

      if (result.exitCode === 0) {
        return {
          code,
          stdout: result.stdout,
          stderr: result.stderr,
          iterations: attempt,
        };
      }

      lastError =
        result.stderr || `Process exited with code ${result.exitCode}`;
      console.log(`[Attempt ${attempt}] Failed:`, lastError);
    }

    throw new FatalError(
      `Code failed after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}`,
    );
  } finally {
    await stopSandbox(sandbox);
  }
}
