import { createWebhook, getWritable } from "workflow";
import { Sandbox } from "@vercel/sandbox";
import { FatalError } from "workflow";
import { generateCode, fixCode } from "@/steps/ai";
import { updateStatus } from "@/steps/status";

const MAX_ATTEMPTS = 3;

export type Runtime = "node24" | "node22" | "python3.13" | "bash";

export type RunCodeResult =
  | { success: true; code: string; iterations: number }
  | { success: false; code: string; error: string; iterations: number };

const RUNTIME_CONFIG: Record<
  Runtime,
  { lang: string; ext: string; cmd: string; sandboxRuntime?: string }
> = {
  node24: { lang: "Node.js", ext: "js", cmd: "node" },
  node22: { lang: "Node.js", ext: "js", cmd: "node" },
  "python3.13": { lang: "Python", ext: "py", cmd: "python3" },
  bash: { lang: "Bash", ext: "sh", cmd: "bash", sandboxRuntime: "node24" },
};

export async function runCode(
  prompt: string,
  runtime: Runtime = "node24",
): Promise<RunCodeResult> {
  "use workflow";

  const config = RUNTIME_CONFIG[runtime];
  const filename = `script.${config.ext}`;

  const stdout = getWritable<string>({ namespace: "stdout" });
  const stderr = getWritable<string>({ namespace: "stderr" });
  const status = getWritable<string>({ namespace: "status" });

  await updateStatus(status, "creating-sandbox", 0);

  // Sandbox.create() has "use step" built in, so it runs as a
  // durable step. The returned Sandbox instance is automatically
  // serialized via WORKFLOW_SERIALIZE when it crosses the step boundary.
  const sandbox = await Sandbox.create({
    resources: { vcpus: 1 },
    timeout: 5 * 60 * 1000,
    runtime: config.sandboxRuntime ?? runtime,
  });

  try {
    await updateStatus(status, "generating", 1);
    let code = await generateCode(prompt, config.lang);
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (lastError) {
        await updateStatus(status, "fixing", attempt);
        code = await fixCode(prompt, code, lastError, config.lang);
      }

      await updateStatus(status, "writing", attempt, code);
      await sandbox.writeFiles([{ path: filename, content: code }]);

      await updateStatus(status, "running", attempt);

      const cmd = await sandbox.runCommand({
        cmd: config.cmd,
        args: [filename],
        stdout,
        stderr,
        detached: true,
      });

      // Each Sandbox instance method (writeFiles, runCommand, stop, etc.)
      // also has "use step" built in, so every call below is its own
      // durable step — and the sandbox object is automatically rehydrated
      // via WORKFLOW_DESERIALIZE at each step boundary.
      await sandbox.writeFiles([{ path: "script.js", content: code }]);

      const finished = await cmd.wait();
      const stdout = await finished.stdout();
      const stderr = await finished.stderr();

      if (finished.exitCode === 0) {
        await updateStatus(status, "stopping", attempt);
        return {
          code,
          stdout,
          stderr,
          iterations: attempt,
        };
      }

      lastError = stderr || `Process exited with code ${finished.exitCode}`;
      console.log(`[Attempt ${attempt}] Failed:`, lastError);
    }

    await updateStatus(status, "stopping", MAX_ATTEMPTS);
    return {
      success: false,
      code,
      error: lastError,
      iterations: MAX_ATTEMPTS,
    };
  } finally {
    await sandbox.stop();
  }
}
