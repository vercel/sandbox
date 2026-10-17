import { execSync } from "node:child_process";

function call(args: string) {
  return execSync(`./bin/sandbox.mjs ${args}`, { encoding: "utf8" });
}

const docs = {
  "sandbox --help": "--help",
  "sandbox list": "list --help",
  "sandbox run": "run --help",
  "sandbox create": "create --help",
  "sandbox sh": "sh --help",
  "sandbox fork": "fork --help",
  "sandbox exec": "exec --help",
  "sandbox stop": "stop --help",
  "sandbox extend": "extend --help",
  "sandbox commands": "commands --help",
  "sandbox commands get": "commands get --help",
  "sandbox commands logs": "commands logs --help",
  "sandbox commands wait": "commands wait --help",
  "sandbox commands kill": "commands kill --help",
  "sandbox commands write": "commands write --help",
  "sandbox commands close-stdin": "commands close-stdin --help",
  "sandbox commands output": "commands output --help",
  "sandbox domain": "domain --help",
  "sandbox users": "users --help",
  "sandbox users create": "users create --help",
  "sandbox users exec": "users exec --help",
  "sandbox groups": "groups --help",
  "sandbox groups create": "groups create --help",
  "sandbox groups add-user": "groups add-user --help",
  "sandbox groups remove-user": "groups remove-user --help",
  "sandbox copy": "copy --help",
  "sandbox connect": "connect --help",
  "sandbox snapshot": "snapshot --help",
  "sandbox snapshots": "snapshots --help",
  "sandbox drives": "drives --help",
  "sandbox drives fork": "drives fork --help",
  "sandbox config": "config --help",
  "sandbox config network-id": "config network-id --help",
  "sandbox config network": "config network --help",
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
