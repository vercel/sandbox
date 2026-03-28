import { getWritable } from "workflow";
import { Sandbox } from "@vercel/sandbox";
import { generateCode, fixCode } from "@/steps/ai";
import { updateStatus } from "@/steps/status";

const MAX_ATTEMPTS = 3;

export type RunCodeResult =
  | { success: true; code: string; iterations: number }
  | { success: false; code: string; error: string; iterations: number };

export async function runCode(prompt: string): Promise<RunCodeResult> {
  "use workflow";

  const sandbox = await Sandbox.create({
    resources: { vcpus: 1 },
    timeout: 5 * 60 * 1000,
    runtime: "node22",
  });

  // Named writable streams — the UI can read these via run.getReadable()
  const stdout = getWritable<string>({ namespace: "stdout" });
  const stderr = getWritable<string>({ namespace: "stderr" });
  const status = getWritable<string>({ namespace: "status" });

  try {
    await updateStatus(status, "generating", 1);
    let code = await generateCode(prompt);
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (lastError) {
        await updateStatus(status, "fixing", attempt);
        code = await fixCode(prompt, code, lastError);
      }

      await updateStatus(status, "running", attempt, code);

      await sandbox.writeFiles([{ path: "script.js", content: code }]);

      // In workflow context, runCommand automatically creates a webhook
      // and wraps the command to POST the exit code on completion.
      // cmd.wait() then suspends the workflow until the webhook fires,
      // instead of blocking a step polling for completion.
      const cmd = await sandbox.runCommand({
        cmd: "node",
        args: ["script.js"],
        stdout,
        stderr,
        detached: true,
      });

      const finished = await cmd.wait();

      if (finished.exitCode === 0) {
        return { success: true, code, iterations: attempt };
      }

      lastError = `Process exited with code ${finished.exitCode}`;
      console.log(`[Attempt ${attempt}] Failed:`, lastError);
    }

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
