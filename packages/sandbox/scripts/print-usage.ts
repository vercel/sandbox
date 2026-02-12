import { execSync } from "node:child_process";

function call(args: string) {
  return execSync(`./bin/sandbox.mjs ${args}`, { encoding: "utf8" });
}

const docs = {
  "sandbox --help": "--help",
  "sandbox list": "list --help",
  "sandbox run": "run --help",
  "sandbox create": "create --help",
  "sandbox exec": "exec --help",
  "sandbox stop": "stop --help",
  "sandbox copy": "copy --help",
  "sandbox connect": "connect --help",
  "sandbox snapshot": "snapshot --help",
  "sandbox snapshots": "snapshots --help",
  "sandbox config network-policy": "config network-policy --help",
  "sandbox login": "login --help",
  "sandbox logout": "logout --help",
};

execSync("turbo build", {
  stdio: ["ignore", process.stderr, "inherit"],
});

const markdown = [] as string[];
for (const [title, cmd] of Object.entries(docs)) {
  const help = call(cmd);

  markdown.push(`## \`${title}\`\n\n\`\`\`\n${help.trim()}\n\`\`\``);
}

console.log(markdown.join("\n\n"));
