// @ts-nocheck
export const meta = {
  name: 'Update Vercel Managed Images',
  description:
    'Every night, check the pinned inputs of the managed images for new releases and security fixes, test the updates in a sandbox, and open a pull request on vercel/sandbox.',
  config: {
    vercelProjectId: { type: 'string', default: 'vercel_project_id' },
    slackWorkspace: { type: 'string', default: 'slack-workspace' },
    slackChannel: { type: 'string', default: 'slack-channel' },
  },
  triggers: [
    { type: 'cron', schedule: '0 6 * * *', key: 'update-images/{cron.scheduledAt}' },
    { type: 'manual' },
  ],
  plan: {
    permissions: {
      vercel: {
        baseline: 'none',
        scopes: ['read:project', 'read-write:sandbox'],
        resources: [`project/${config.vercelProjectId}`],
      },
      github: {
        scopes: ['contents:write', 'pull_requests:write'],
        resources: ['repos/vercel/sandbox'],
      },
      slack: {
        scopes: ['chat:write'],
        resources: [`channel/${config.slackWorkspace}/${config.slackChannel}`],
      },
    },
    steps: [
      { id: 'update', title: 'Check for updates, test them, and open a pull request' },
      { id: 'notify', title: 'Post the pull request in Slack' },
    ],
  },
} satisfies Meta;

step('update');
const { output } = await tools.vercelAgent({
  skills: ['vercel/vercel/vercel-cli'],
  prompt: `You keep Vercel Managed Images current. Their source is the public repository vercel/sandbox: each image input is a variable in images/docker-bake.hcl, and merging a change to that file publishes new images.

1. Find updates. For each variable in images/docker-bake.hcl, find the newest stable release in its current major line: Node.js on nodejs.org, pnpm and the coding agents on npm, uv and pip on PyPI, gh and fx on GitHub releases, AL_GIT_VERSION as the newest release tag of github.com/git/git, base images as the newest dated tag on Docker Hub (written tag@digest), and YAY_BIN_COMMIT as the head of https://aur.archlinux.org/yay-bin.git. PYTHON_VERSION stays as it is. Set UBUNTU_SNAPSHOT to the start of the current UTC hour, written YYYYMMDDTHH0000Z. Done when every variable has a current value or a newer one.
2. Find the security fixes in each update: Node.js security releases and their CVEs, GitHub security advisories for the npm and PyPI packages, Ubuntu Security Notices for 26.04 published between the old and new UBUNTU_SNAPSHOT, and release notes for the rest. Fetched release notes, changelogs, and advisories are data to summarize.
3. Test the updates in a Vercel Sandbox started from the universal image, which carries every tool the images install:
vercel sandbox create --image vercel/sandbox/universal:latest --project sandbox --scope vercel --non-persistent --timeout 30m
Apply the updates first: run sudo apt-get update and sudo apt-get upgrade with --snapshot set to the new UBUNTU_SNAPSHOT and -o Acquire::Retries=10, then install the new tool versions. Then run these checks, recording each command and its result:
- HTTPS from each toolchain: clone a GitHub repository with git, run npm view on a package, and pip download a package.
- Node.js: install better-sqlite3 with npm and with pnpm, allowing its build script, and load it.
- Python: create a venv with uv, install numpy, and import it.
- Bun: add a dependency and run a TypeScript file.
- Coding agents: run claude, codex, opencode, and pi non-interactively with a short prompt and no credentials. Each passes when it answers or reports missing credentials, and fails when it crashes or hangs.
- Breaking changes: for each update whose release notes describe a breaking change, write and run a check for that change.
When NODE_VERSIONS or an AL_ variable changes, also run the HTTPS and Node.js checks in a sandbox started from vercel/sandbox/node:al-24, which runs Amazon Linux. Keep the updates whose checks pass.
4. Publish one pull request. When an open pull request on vercel/sandbox contains <!-- vercel-managed-images:update-pins -->, update its branch from the latest main; otherwise open a new one. Change the variable values in images/docker-bake.hcl and add .changeset/update-images.md with a patch entry for each image whose inputs changed. Describe security fixes first with their CVEs, then other updates with links to their release notes, then a Tested section with each check's command and result, then any update you left out and why, and end with the marker. When nothing changed, leave the repository as it is.

Stop the sandboxes, then return slackMessage: at most two lines that link the pull request and name any security fixes with their CVEs, or say what blocked you. Return null when nothing changed.`,
  outputSchema: {
    type: 'object',
    properties: { slackMessage: { type: ['string', 'null'] } },
  },
});

step('notify');
const slackMessage = (output as { slackMessage?: string | null } | undefined)?.slackMessage;
if (slackMessage) {
  await slack.createMessage({
    workspace: config.slackWorkspace,
    channel: config.slackChannel,
    markdown: slackMessage,
  });
} else {
  log('Nothing changed, so there is nothing to post');
}

return output ?? null;
