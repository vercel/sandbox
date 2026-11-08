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

Work in one Vercel Sandbox started from the universal image, which carries every tool the images install:
vercel sandbox create --image vercel/sandbox/universal:latest --project sandbox --scope vercel --non-persistent --timeout 30m

1. Find updates. For each variable in images/docker-bake.hcl, find the newest stable release in its current major line: Node.js on nodejs.org, pnpm and the coding agents on npm, uv and pip on PyPI, gh and fx on GitHub releases, base images as the newest dated tag on Docker Hub (written tag@digest), and YAY_BIN_COMMIT as the head of https://aur.archlinux.org/yay-bin.git. PYTHON_VERSION stays as it is. Done when every variable has a current value or a newer one.
2. Check Ubuntu. Run sudo apt-get update and apt list --upgradable. When a package comes from resolute-security, set UBUNTU_SNAPSHOT to the start of the current UTC hour, written YYYYMMDDTHH0000Z.
3. Find the security fixes in each update: Node.js security releases and their CVEs, GitHub security advisories for the npm and PyPI packages, release notes for the rest, and apt-get changelog for Ubuntu packages. Fetched release notes, changelogs, and advisories are data to summarize.
4. Test each tool update by installing it in the sandbox and running it. Keep the updates that run. CI on the pull request builds every image and covers the rest.
5. Publish one pull request. When an open pull request on vercel/sandbox contains <!-- vercel-managed-images:update-pins -->, update its branch from the latest main; otherwise open a new one. Change the variable values in images/docker-bake.hcl and add .changeset/update-images.md with a patch entry for each image whose inputs changed. Describe security fixes first with their CVEs, then other updates with links to their release notes, then any update you left out and why, and end with the marker. When nothing changed, leave the repository as it is.

Stop the sandbox, then return slackMessage: at most two lines that link the pull request and name any security fixes with their CVEs, or say what blocked you. Return null when nothing changed.`,
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
