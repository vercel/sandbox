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
```

Add `--ai` to enable AI Gateway. On the universal image, this also prepares all
four agents, or the selected agent:

```bash
sandbox create --ai
sandbox create --ai codex
sandbox create --ai claude
sandbox create --ai opencode
sandbox create --ai pi
```

Bare `--ai` prepares all four agents in the standard universal image without
launching one. Selecting an agent prepares that agent and opens it.

Use your own image for Gateway access without changing agent configuration:

```bash
sandbox create --image my-image --ai
```

This preserves your image and its configuration files on creation and reconnect.
Your application must target `https://ai-gateway.vercel.sh` using its supported
API path and the placeholder `AI_GATEWAY_API_KEY` provided in the sandbox.
The external firewall supplies the real credential. No agents are installed or
configured on custom images, even if an agent is later started with `sandbox exec`.
Agent shortcuts require the universal image. `--ai` cannot be combined with
`--runtime` or `--snapshot`.

`--ai` requests a managed session key using your Vercel login. On teams with
managed Gateway enabled, that login authorizes a dedicated
key for each running sandbox session. The backend injects it through the egress
firewall; the CLI and agent configuration receive no key secret. Reconnecting
uses the running session. Resuming a stopped sandbox rechecks permissions and
provisions a fresh key. Session termination requests revocation of that session's
key. Managed Gateway requires the corresponding backend rollout.

`--ai` ignores local and saved Gateway keys. If managed access is unavailable,
creation fails without switching to a personal key. After setup succeeds, the CLI
prints the credential mode to stderr unless you pass `--silent`.

To use your own reusable key, opt in explicitly:

```sh
sandbox gateway setup
sandbox create --ai --use-gateway-key codex
```

Setup lets you create or save a key in your OS credential store. With
`--use-gateway-key`, a host `AI_GATEWAY_API_KEY` takes precedence over the saved key.
If neither exists, creation fails with setup instructions. The CLI does not
search your project's keys. Reusable keys keep their own billing and expiry
settings and are not revoked when a sandbox stops. Never pass a key with `--env`
or as a flag value.

Sandboxes created with a supplied or saved key remain bound to that key.
Reconnect from another computer requires the original key. Changing the saved
key affects new sandboxes; earlier keys remain available for existing ones.

The default `--ai` policy permits outbound traffic, with credential injection
limited to TLS requests for AI Gateway. Connections without a detectable domain
pass through unmodified. To restrict egress, use a domain allowlist without `*`
and include `ai-gateway.vercel.sh`. Automatic
setup rejects deny-all, allowed CIDRs, and conflicting request rules instead of
changing their meaning. One sandbox tag is reserved for automatic reconnect.

Secure storage requires an available OS credential store (Secret Service on
Linux). If secure storage is unavailable, use managed Gateway or a host environment
key with `--ai --use-gateway-key`. Keys are never saved as plaintext. Saved CLI-created keys must remain valid for the session duration plus one hour
(25 hours when interactive sessions automatically extend their timeout). Imported keys may have a separately managed expiry. Budget exhaustion
or revocation can interrupt any session.
