import { Sandbox, setSandboxCredentials } from "@vercel/sandbox";
import { FatalError } from "workflow";
import { generateCode, fixCode } from "@/steps/ai";

// Set credentials at module scope so deserialized Sandbox instances
// can lazily create API clients in any step context.
setSandboxCredentials({
  token: process.env.VERCEL_TOKEN!,
  teamId: process.env.VERCEL_TEAM_ID!,
  projectId: process.env.VERCEL_PROJECT_ID!,
});

const MAX_ATTEMPTS = 3;

export async function runCode(prompt: string) {
  "use workflow";

  // Sandbox.create() has "use step" built in — this is a durable step.
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

      // Each SDK method (writeFiles, runCommand, stdout, stderr)
      // is annotated with "use step" — no wrapper functions needed.
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
