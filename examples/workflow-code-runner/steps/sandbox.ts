import { Sandbox, setSandboxCredentials } from "@vercel/sandbox";

// Set credentials at module scope so they're available in every step
// context, including nested steps from SDK methods like writeFiles(),
// runCommand(), etc. which are each executed as their own step.
setSandboxCredentials({
  token: process.env.VERCEL_TOKEN!,
  teamId: process.env.VERCEL_TEAM_ID!,
  projectId: process.env.VERCEL_PROJECT_ID!,
});

export async function createSandbox() {
  "use step";

  console.log("[Sandbox] Creating...");

  const sandbox = await Sandbox.create({
    resources: { vcpus: 1 },
    timeout: 5 * 60 * 1000,
    runtime: "node22",
  });

  console.log("[Sandbox] Created:", sandbox.sandboxId);

  // Return the full Sandbox object — workflow serialization
  // automatically dehydrates it via WORKFLOW_SERIALIZE
  return sandbox;
}

// The Sandbox object is deserialized via WORKFLOW_DESERIALIZE when
// it crosses the step boundary — no need for Sandbox.get(id)
export async function execute(sandbox: Sandbox, code: string) {
  "use step";

  console.log("[Sandbox] Executing code...");

  await sandbox.writeFiles([{ path: "script.js", content: Buffer.from(code) }]);

  const finished = await sandbox.runCommand("node", ["script.js"]);
  const stdout = await finished.stdout();
  const stderr = await finished.stderr();

  return {
    exitCode: finished.exitCode,
    stdout,
    stderr,
  };
}

export async function stopSandbox(sandbox: Sandbox) {
  "use step";

  console.log("[Sandbox] Stopping...");
  await sandbox.stop();
}
