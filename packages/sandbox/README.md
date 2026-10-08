# Vercel Sandbox CLI

Vercel Sandbox allows you to run arbitrary code in isolated, ephemeral Linux
VMs. View the documentation [here](https://vercel.com/docs/vercel-sandbox).

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
sandbox create opencode # Create a new sandbox and open OpenCode
sandbox ls # List your sandboxes
sandbox --help # View all commands
```

Learn more about the CLI in the [documentation](https://vercel.com/docs/vercel-sandbox/cli-reference).

### OpenCode

Run `sandbox create opencode` in an interactive terminal. It creates a fresh
sandbox using `vercel/sandbox/universal` and opens the preinstalled OpenCode
directly. You do not need OpenCode installed locally. Local project files,
OpenCode configuration, and saved model credentials are not copied into it.
Use `--env KEY=value` to pass environment variables explicitly.

Vercel login is required, and Sandbox compute and storage charges apply.
Model availability and authentication are managed by OpenCode and your chosen
provider. A model that requires credentials must be configured inside the sandbox
or through explicit environment variables.

Exiting OpenCode leaves the sandbox running until its timeout. As with other
interactive Sandbox CLI sessions, the timeout is extended while connected.
The CLI prints commands to reconnect to OpenCode or stop the sandbox when the
session ends. Stop it when you are finished to avoid continued compute usage.
The normal Sandbox persistence settings apply; `--non-persistent` disables
automatic filesystem restoration between sessions.

The shortcut selects its image, so it cannot be combined with `--image`,
`--runtime`, or `--snapshot`. OpenCode auto-updates are disabled for the session
unless you explicitly pass `--env OPENCODE_DISABLE_AUTOUPDATE=false`.
