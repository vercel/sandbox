import { Sandbox } from "@vercel/sandbox";

async function main() {
  console.log("Creating sandbox with 1Password secrets...\n");

  const sandbox = await Sandbox.create({
    timeout: 30000,
    env: {
        secretsFrom1Password: {
          MY_SECRET: process.env.OP_REF,
        },
      },
  });

  console.log("Sandbox created. Running command that uses the secret...\n");

  const result = await sandbox.runCommand("bash", [
    "-c",
    "echo \"MY_SECRET is set: ${MY_SECRET:+yes}\" && echo \"Length: ${#MY_SECRET}\"",
  ]);

  console.log(await result.stdout());
  await sandbox.stop();
  console.log("\nDone.");
}

main().catch(console.error);
