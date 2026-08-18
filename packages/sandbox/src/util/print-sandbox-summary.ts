import chalk from "chalk";
import type { Sandbox } from "@vercel/sandbox";

interface Scope {
  team: string;
  project: string;
  teamSlug?: string;
  projectSlug?: string;
}

/**
 * Print the "✅ Sandbox <name> <action>." summary that the create and fork
 * commands emit after a successful creation, including project/team and any
 * published port routes.
 *
 * - The sandbox name is written to stdout, everything else to stderr — so
 *   `sandbox create | xargs -I {} sandbox exec {} -- ...` keeps working.
 * - Pass `action: "created"` for create, or `action: \`forked from ${chalk.cyan(source)}\``
 *   for fork.
 */
export function printSandboxSummary(opts: {
  sandbox: Sandbox;
  scope: Scope;
  action: string;
  /** Append a "connect with" hint so the output never ends at a dead end. */
  connectHint?: boolean;
}) {
  const { sandbox, scope, action, connectHint } = opts;
  const teamDisplay = scope.teamSlug ?? scope.team;
  const projectDisplay = scope.projectSlug ?? scope.project;
  const routes = sandbox.routes.filter(
    (x) => x.port !== sandbox.interactivePort,
  );
  const hasPorts = routes.length > 0;

  process.stderr.write("✅ Sandbox ");
  process.stdout.write(chalk.cyan(sandbox.name));
  process.stderr.write(" " + action + ".\n");
  process.stderr.write(
    chalk.dim("   │ ") + "team: " + chalk.cyan(teamDisplay) + "\n",
  );
  process.stderr.write(
    chalk.dim("   │ ") + "region: " + chalk.cyan(sandbox.region ?? "iad1") + "\n",
  );

  // With a connect hint, the hint becomes the closing "╰" line.
  const close = (last: boolean) => chalk.dim(last && !connectHint ? "   ╰ " : "   │ ");

  if (hasPorts) {
    process.stderr.write(
      chalk.dim("   │ ") + "project: " + chalk.cyan(projectDisplay) + "\n",
    );
    process.stderr.write(chalk.dim("   │ ") + "ports:\n");
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      const isLast = i === routes.length - 1;
      process.stderr.write(
        close(isLast) + "• " + route.port + " -> " + chalk.cyan(route.url) + "\n",
      );
    }
  } else {
    process.stderr.write(
      close(true) + "project: " + chalk.cyan(projectDisplay) + "\n",
    );
  }

  if (connectHint) {
    process.stderr.write(
      chalk.dim("   ╰ ") +
        "connect with: " +
        chalk.cyan(`sandbox ssh ${sandbox.name}`) +
        "\n",
    );
  }
}
