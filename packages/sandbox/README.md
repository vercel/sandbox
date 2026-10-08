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
sandbox create claude # Create a new sandbox and open Claude Code
sandbox create pi # Create a new sandbox and open Pi
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

### Claude Code

Run `sandbox create claude` in an interactive terminal to open the preinstalled
Claude Code in a fresh `vercel/sandbox/universal` sandbox. You do not need Claude
Code installed locally. Local project files, configuration, and saved credentials
are not copied into the sandbox.

Vercel login is required, and Sandbox compute and storage charges apply. Claude
Code requires its own authentication. Follow its login prompts; if the browser
cannot open from the sandbox, open the displayed URL locally and paste the login
code back into the terminal when prompted. Alternatively, pass an API key
explicitly with `--env ANTHROPIC_API_KEY=...` and confirm its use when Claude asks.
See [Claude Code authentication](https://code.claude.com/docs/en/authentication)
for supported accounts and billing.

Exiting Claude Code leaves the sandbox running. The CLI prints scoped reconnect
and stop commands. Reconnect launches `claude --continue`, which loads the most
recent conversation in the same working directory; it does not restore an
interrupted process. If you exited before creating a conversation, run the
printed reconnect command without `--continue` to start a new one. If you supplied
`--env` options, export those same variables and values in your local shell before
reconnecting. The printed command forwards their names without displaying their
values; this includes model-provider authentication and configuration.

Stop the sandbox when finished. The timeout extends while connected, and normal
Sandbox persistence settings apply. `--non-persistent` disables automatic
filesystem restoration. The shortcut cannot be combined with `--image`,
`--runtime`, or `--snapshot`. Environment variables are passed only when supplied
with `--env`; Claude's permission checks remain enabled.

### Pi

Run `sandbox create pi` in an interactive terminal to open the preinstalled Pi
coding agent in a fresh `vercel/sandbox/universal` sandbox. You do not need Pi
installed locally. Local project files, configuration, extensions, and saved
credentials are not copied into the sandbox.

Vercel login is required, and Sandbox compute and storage charges apply. Pi
requires separate model authentication. Run `/login` inside Pi to select an
account or API-key provider, or pass credentials explicitly with `--env KEY=value`.
For example, Pi supports `--env AI_GATEWAY_API_KEY=...` for Vercel AI Gateway.
Vercel does not supply model credentials. See [Pi authentication](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md)
for supported providers and remote login instructions.

Exiting Pi leaves the sandbox running. The CLI prints scoped reconnect and stop
commands. Reconnect launches `pi --continue`, which opens the most recent session
for the same working directory; it does not restore an interrupted process.
Pi stores sessions inside the sandbox under `~/.pi/agent/sessions/` by default.
If you supplied `--env` options, export those same variables and values in your
local shell before reconnecting. The printed command forwards their names without
displaying their values.

Stop the sandbox when finished. The timeout extends while connected, and normal
Sandbox persistence settings apply. `--non-persistent` disables automatic
filesystem restoration. The shortcut cannot be combined with `--image`,
`--runtime`, or `--snapshot`. Environment variables are passed only when supplied
with `--env`.
