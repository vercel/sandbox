import { FatalError } from "workflow";
import { Sandbox } from "@vercel/sandbox";
import { generateCode, fixCode } from "@/steps/ai";

const MAX_ATTEMPTS = 3;

export async function runCode(prompt: string) {
  "use workflow";

  const sandbox = await Sandbox.create({
    resources: { vcpus: 1 },
    timeout: 5 * 60 * 1000,
    runtime: "node22",
  });

  try {
    let code = await generateCode(prompt);
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (lastError) {
        code = await fixCode(prompt, code, lastError);
      }

      await sandbox.writeFiles([
        { path: "script.js", content: Buffer.from(code) },
      ]);

      const finished = await sandbox.runCommand("node", ["script.js"]);
      const stdout = await finished.stdout();
      const stderr = await finished.stderr();

      if (finished.exitCode === 0) {
        return { code, stdout, stderr, iterations: attempt };
      }

      lastError = stderr || `Process exited with code ${finished.exitCode}`;
      console.log(`[Attempt ${attempt}] Failed:`, lastError);
    }

    throw new FatalError(
      `Code failed after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}`,
    );
  } finally {
    await sandbox.stop();
  }
}
