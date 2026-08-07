# Vercel Sandbox

Vercel Sandbox allows you to run arbitrary code in isolated, ephemeral Linux
VMs. View the documentation [here](https://vercel.com/docs/vercel-sandbox).

## Packages

- [`@vercel/sandbox`](https://www.npmjs.com/package/@vercel/sandbox) - The SDK for programmatic access to Vercel Sandbox. [Source](https://github.com/vercel/sandbox/tree/main/packages/vercel-sandbox) | [Documentation](https://vercel.com/docs/vercel-sandbox/sdk-reference)
- [`sandbox`](https://www.npmjs.com/package/sandbox) - The CLI for interacting with Vercel Sandbox from the command line. [Source](https://github.com/vercel/sandbox/tree/main/packages/sandbox) | [Documentation](https://vercel.com/docs/vercel-sandbox/cli-reference)

## What is a sandbox?

A sandbox is an isolated Linux system for your experimentation and use.
Internally, it is a Firecracker MicroVM that is powered by [the same
infrastructure][hive] that powers 2M+ builds a day at Vercel.

## Getting started

To get started using Ubuntu with Node.js 24, create a new project:

```sh
mkdir my-sandbox-app && cd my-sandbox-app
npm init -y
vercel link
```

Pull your authentication token:

```sh
vercel env pull
```

Install the Sandbox SDK:

```sh
pnpm i @vercel/sandbox
```

Install the Sandbox Skill:

```sh
npx skills add vercel/sandbox
```

Create a `index.mts` file:

```ts
import { Sandbox } from "@vercel/sandbox";
import { setTimeout } from "timers/promises";
import { spawn } from "child_process";

async function main() {
  const sandbox = await Sandbox.create({
    source: {
      url: "https://github.com/vercel/sandbox-example-next.git",
      type: "git",
    },
    resources: { vcpus: 4 },
    ports: [3000],
  });

  console.log(`Installing dependencies...`);
  const install = await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "--loglevel", "info"],
    cwd: "sandbox-example-next",
    stderr: process.stderr,
    stdout: process.stdout,
  });

  if (install.exitCode != 0) {
    console.log("installing packages failed");
    process.exit(1);
  }

  console.log(`Starting the development server...`);
  await sandbox.runCommand({
    cmd: "npm",
    args: ["run", "dev"],
    cwd: "sandbox-example-next",
    stderr: process.stderr,
    stdout: process.stdout,
    detached: true,
  });

  await setTimeout(500);
  spawn("open", [sandbox.domain(3000)]);
}

main().catch(console.error);
```

Run it:

```sh
node --experimental-strip-types --env-file .env.local index.mts
```

This will:

- Start a sandbox, seeding it with a git repository.
- Install dependencies.
- Run a `next dev` server
- Open it in your browser

All while streaming logs to your local terminal.

## Authentication

### Vercel OIDC token

The SDK uses Vercel OIDC tokens to authenticate whenever available. This is the
most straightforward and recommended way to authenticate.

When developing locally, you can download a development token to `.env.local`
using `vercel env pull`. After 12 hours the development token expires, meaning
you will have to call `vercel env pull` again.

In production, Vercel manages token expiration for you.

### Access token

If you want to use the SDK from an environment where `VERCEL_OIDC_TOKEN` is
unavailable, you can also authenticate using an access token:

- Go to your team settings, and copy the team ID.
- Go to a project's settings, and copy the project ID.
- Go to your Vercel account settings and [create a token][create-token]. Make
  sure it is scoped to the team ID from the previous step.

Set your team ID, project ID, and token to the environment variables
`VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_TOKEN`. Then pass these to
the `create` method:

```ts
const sandbox = await Sandbox.create({
  teamId: process.env.VERCEL_TEAM_ID!,
  projectId: process.env.VERCEL_PROJECT_ID!,
  token: process.env.VERCEL_TOKEN!,
  source: {
    url: "https://github.com/vercel/sandbox-example-next.git",
    type: "git",
  },
  resources: { vcpus: 4 },
  // Defaults to 5 minutes. The maximum is 24 hours for Pro/Enterprise, and 45 minutes for Hobby.
  timeout: ms("5m"),
  ports: [3000],
});
```

## Workflow DevKit integration

`Sandbox` and `CommandFinished` support serialization with the
[Workflow DevKit](https://vercel.com/docs/workflow). When a sandbox instance
crosses a step boundary the SDK serializes sandbox metadata and routes, then
rehydrates synchronously from that snapshot. Deserialized instances lazily
recreate an API client using OIDC or environment credentials when needed.

## Limitations

- Max resources: 8 vCPUs on Hobby/Pro, 32 vCPUs on Enterprise. You will get 2048 MB of memory per vCPU.
- Sandboxes have a maximum duration of 24 hours for Pro/Enterprise and 45 minutes for Hobby,
  with a default of 5 minutes. This can be configured using the `timeout` option of `Sandbox.create()`.

## Sudo access

The default image allows users to run commands as root. This can be used to
install packages and system tools:

```typescript
import { Sandbox } from "@vercel/sandbox";

const sandbox = await Sandbox.create();
await sandbox.runCommand({
  cmd: "apt-get",
  args: ["update"],
  sudo: true,
});
await sandbox.runCommand({
  cmd: "apt-get",
  args: ["install", "-y", "golang-go"],
  sudo: true,
});
```

Sandbox runs sudo in the following configuration:

- `HOME` is set to `/root` – Executed commands will source root's configuration
  files (e.g. `.gitconfig`, `.bashrc`, etc).
- Environment variables are not reset before executing the command.
- `PATH` is left unchanged – sudo won't change the value of PATH, so local or
  project-specific binaries will still be found.

[create-token]: https://vercel.com/account/settings/tokens
[hive]: https://vercel.com/blog/a-deep-dive-into-hive-vercels-builds-infrastructure
[vcr-docs]: https://vercel.com/docs/container-registry
[images-docs]: https://vercel.com/docs/sandbox/concepts/images

The skill provides comprehensive guidance on using the `@vercel/sandbox` SDK, including code patterns, best practices, and API reference.

## Default image

Sandboxes use [`vercel/sandbox/universal:latest`](./images/universal) by
default. This Ubuntu-based image includes Node.js 24, Bun, Python 3.14, coding
agents, and common development and debugging utilities. It runs as the
`ubuntu` user with passwordless sudo.

## Vercel Managed Images

Vercel provides several public images optimized to use in Sandbox.
The Dockerfiles for Vercel Managed Images published under `vercel/sandbox/*` live in [`images/`](https://github.com/vercel/sandbox/tree/main/images):

- [`vercel/sandbox/universal:latest`](./images/universal): Default image with Node.js, Python, coding agents, and utilities.
- [`vercel/sandbox/node:22|24|26`](./images/node): Node.js with pnpm.
- [`vercel/sandbox/python:3.14`](./images/python): Python with pip, venv, and uv.
- [`vercel/sandbox/ubuntu:latest`](./images/ubuntu): Minimal Ubuntu base.
- [`vercel/sandbox/arch:latest`](./images/arch): Arch Linux with yay/AUR support.

See the [images README](https://github.com/vercel/sandbox/tree/main/images#readme)
for build instructions.

### Custom images

A sandbox can boot from any OCI image by pushing it to
[Vercel Container Registry (VCR)][vcr-docs] and passing `image` to
`Sandbox.create()`.

Build and push a `linux/amd64` image to VCR:

```sh
vercel vcr login docker
vercel vcr build docker . my-repository:latest --push
```

The CLI uses the linked project, defaults to `linux/amd64`, and constructs the
full VCR reference automatically.

VCR implements the Docker Registry API, so any OCI compatible tooling can also be used, such as `buildah` or `podman`.

Then start a sandbox from it:

```ts
const sandbox = await Sandbox.create({
  image: "my-repository:latest",
});
```

See the [images documentation][images-docs] for more details.

## Authors

This library is created by [Vercel](https://vercel.com) team members, with contributions from the [Open Source Community](https://github.com/vercel/sandbox/graphs/contributors) welcome and highly appreciated.
