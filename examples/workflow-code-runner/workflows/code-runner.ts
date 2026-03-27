import { FatalError, getWritable } from "workflow";
import { Sandbox } from "@vercel/sandbox";
import { Writable } from "stream";
import { generateCode, fixCode } from "@/steps/ai";

const MAX_ATTEMPTS = 3;

/**
 * Convert a Web WritableStream<string> into a Node.js Writable stream
 * so it can be passed to sandbox.runCommand({ stdout, stderr }).
 */
function toNodeWritable(webStream: WritableStream<string>): Writable {
  const writer = webStream.getWriter();
  return new Writable({
    write(chunk, _encoding, callback) {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      writer.write(text).then(() => callback(), callback);
    },
    final(callback) {
      writer.close().then(() => callback(), callback);
    },
  });
}

export async function runCode(prompt: string) {
  "use workflow";

  const sandbox = await Sandbox.create({
    resources: { vcpus: 1 },
    timeout: 5 * 60 * 1000,
    runtime: "node22",
  });

  // Named writable streams — the UI can read these via run.getReadable()
  const stdoutStream = getWritable<string>({ namespace: "stdout" });
  const stderrStream = getWritable<string>({ namespace: "stderr" });

  const stdout = toNodeWritable(stdoutStream);
  const stderr = toNodeWritable(stderrStream);

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

      const cmd = await sandbox.runCommand({
        cmd: "node",
        args: ["script.js"],
        stdout,
        stderr,
        detached: true,
      });

      const finished = await cmd.wait();

      if (finished.exitCode === 0) {
        return { code, iterations: attempt };
      }

      const stderrOutput = await finished.stderr();
      lastError =
        stderrOutput || `Process exited with code ${finished.exitCode}`;
      console.log(`[Attempt ${attempt}] Failed:`, lastError);
    }

    throw new FatalError(
      `Code failed after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}`,
    );
  } finally {
    stdout.end();
    stderr.end();
    await sandbox.stop();
  }
}
