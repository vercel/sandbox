# Vercel Sandbox CLI

Vercel Sandbox allows you to run arbitrary code in isolated Linux microVMs.
Sandboxes are persistent by default: the filesystem is snapshotted when a
session stops and restored when it resumes. View the documentation
[here](https://vercel.com/docs/vercel-sandbox).

## Packages

- [`@vercel/sandbox`](https://www.npmjs.com/package/@vercel/sandbox) - The SDK for programmatic access to Vercel Sandbox. [Source](https://github.com/vercel/sandbox/tree/main/packages/vercel-sandbox) | [Documentation](https://vercel.com/docs/vercel-sandbox/sdk-reference)
- [`sandbox`](https://www.npmjs.com/package/sandbox) (this package) - The CLI for interacting with Vercel Sandbox from the command line. [Source](https://github.com/vercel/sandbox/tree/main/packages/sandbox) | [Documentation](https://vercel.com/docs/vercel-sandbox/cli-reference)

## Installation

```bash
pnpm i -g sandbox
```

## Usage

```bash
sandbox login # If you are not already logged in with the Vercel CLI
sandbox create --connect # Create a new sandbox and open an interactive shell
sandbox ls # List your sandboxes
sandbox --help # View all commands
```

Learn more about the CLI in the [documentation](https://vercel.com/docs/vercel-sandbox/cli-reference).

### Agents

```bash
sandbox create opencode # Create a new sandbox and open OpenCode
sandbox create pi # Create a new sandbox and open Pi
sandbox create claude # Create a new sandbox and open Claude Code
sandbox create codex # Create a new sandbox and open Codex
sandbox create fx # Create a new sandbox and open fx
```

Agent shortcuts require an interactive terminal and use the universal image.
Omit `--image`, `--runtime`, and `--snapshot`. Authenticate with the agent inside
the sandbox, or pass credentials explicitly with `--env`.

For fx, choose a sign-in option on first launch, or pass an exported AI Gateway
API key:

```bash
sandbox create fx --env AI_GATEWAY_API_KEY
```

The shortcut preserves fx's default permissions. fx can update itself inside the
sandbox, so its version may change between sessions. Exiting fx leaves the sandbox
running. Use the printed reconnect command (`fx -c`) to continue the conversation,
or the stop command when you're finished. If you supplied `--env`, export the
same values locally before reconnecting; the hint includes names only.
