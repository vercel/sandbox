import { createInterface } from "node:readline";
import type { CreateContext } from "../args/create-context";
import { CliError } from "./cli-error";
import { managedRepository } from "./creation-input";

const safe = (text: string) =>
  text.replace(
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g,
    "",
  );

export async function confirmCreation(context: CreateContext, name?: string) {
  const { creation, mode, yes } = context;
  // The `--credentials-*` options get the full review screen instead, which
  // `create` drives so a correction can re-run inference.
  if (context.managed) return;
  if (!creation.commitAs && !creation.credentials) return;

  const effects: string[] = [];
  if (creation.commitAs && creation.source?.type === "git") {
    effects.push(`${managedRepository(creation.source.url)}: git:write`);
    effects.push(
      `Commit identity: ${safe(creation.commitAs.name)} <${safe(creation.commitAs.email)}>`,
    );
    effects.push(
      "The commit identity is caller-supplied metadata, not proof of identity or permission.",
    );
  }
  if (creation.credentials) {
    effects.push(
      "Enable GitHub API forwarding; also enable managed Git tooling when signed commits are enabled.",
    );
    if (!creation.credentials.github.length)
      effects.push("No initial GitHub API repository grants.");
    for (const group of creation.credentials.github) {
      const identity = group.actAs
        ? `GitHub user ${group.actAs}`
        : "direct caller's connected GitHub account";
      for (const repository of group.repositories)
        effects.push(
          `${repository}: ${group.actions.join(", ")} (${identity})`,
        );
    }
  }
  effects.push(
    "Sandbox API access is restricted to the creator and effective credential identities resolved by the server; team owners do not bypass this policy.",
  );
  effects.push(
    "Credential expiry is server-managed; this request does not set an expiry.",
  );
  if (!mode.json) {
    process.stderr.write(
      `  Team            ${safe(context.teamSlug ?? context.team)}\n  Project         ${safe(context.projectSlug ?? context.project)}\n  Sandbox         ${name ? safe(name) : "new sandbox (name assigned by the server)"}\n\n`,
    );
    for (const effect of effects) process.stderr.write(`  ${effect}\n`);
    process.stderr.write("\n");
  }
  if (yes) return;
  if (!mode.interactive) {
    throw new CliError(
      "Creating this sandbox requests managed access. Review the effects and pass --yes only after approval.",
      {
        reason: "confirmation_required",
        json: mode.json,
        userActionRequired: true,
        data: { team: context.team, project: context.project, effects },
      },
    );
  }
  const confirmed = await new Promise<boolean>((resolve, reject) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    let answered = false;
    const cancel = () => {
      if (!answered)
        reject(
          new CliError("Sandbox creation canceled.", {
            reason: "canceled",
            exitCode: 130,
          }),
        );
      rl.close();
    };
    rl.once("SIGINT", cancel);
    rl.once("close", () => {
      if (!answered)
        reject(
          new CliError("Sandbox creation canceled.", {
            reason: "canceled",
            exitCode: 130,
          }),
        );
    });
    rl.question("Create sandbox with this managed access? (y/N) ", (answer) => {
      answered = true;
      rl.close();
      resolve(/^(y|yes)$/i.test(answer.trim()));
    });
  });
  if (!confirmed)
    throw new CliError("Sandbox creation canceled.", {
      reason: "canceled",
      exitCode: 130,
    });
}
