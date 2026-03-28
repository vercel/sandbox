import { createWebhook, getWritable } from "workflow";
import { Sandbox } from "@vercel/sandbox";
import { generateCode, fixCode } from "@/steps/ai";
import { updateStatus } from "@/steps/status";

const MAX_ATTEMPTS = 3;

export type Runtime = "node24" | "node22" | "python3.13";

export type RunCodeResult =
  | { success: true; code: string; iterations: number }
  | { success: false; code: string; error: string; iterations: number };

const RUNTIME_CONFIG: Record<
  Runtime,
  { lang: string; ext: string; cmd: string }
> = {
  node24: { lang: "Node.js", ext: "js", cmd: "node" },
  node22: { lang: "Node.js", ext: "js", cmd: "node" },
  "python3.13": { lang: "Python", ext: "py", cmd: "python3" },
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

  const sandbox = await Sandbox.create({
    resources: { vcpus: 1 },
    timeout: 5 * 60 * 1000,
    runtime,
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

      const finished = await cmd.wait();

      if (finished.exitCode === 0) {
        await updateStatus(status, "stopping", attempt);
        return { success: true, code, iterations: attempt };
      }

      lastError = `Process exited with code ${finished.exitCode}`;
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
