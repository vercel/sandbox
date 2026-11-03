# Managed credentials (experimental)

Managed credentials let a sandbox clone a private GitHub repository and call
the GitHub API without a raw GitHub token ever reaching the sandbox, the CLI's
output, or an exported configuration file. Vercel brokers the access.

These inputs require the server-side managed credential feature gates and
permissions for the project. The flags are available without a local opt-in.

Read-only clones require API support for `source.credentials: "read"`.
Configuration reuse requires the API to return the original request metadata.
This CLI change does not deploy either backend contract.

Only GitHub is supported today. GitHub-specific flags use the
`--credentials-github-*` namespace. Other providers can use their own namespace
without changing these flags.

## Contents

- [Quick start](#quick-start)
- [GitHub access presets](#github-access-presets)
- [How a request is assembled](#how-a-request-is-assembled)
- [Inference](#inference)
- [Review and approve](#review-and-approve)
- [Git access and commit credit](#git-access-and-commit-credit)
- [Configuration files](#configuration-files)
- [Reusing a configuration](#reusing-a-configuration)
- [Resources](#resources)
- [Safety rules](#safety-rules)
- [Non-interactive use and JSON](#non-interactive-use-and-json)
- [Testing locally](#testing-locally)

## Quick start

Sign in with `vercel login`, then run from inside a GitHub repository:

```sh
vercel sandbox create --enable-github-credentials
```

You do not need `--scope` and `--project` when the CLI can discover them. OIDC
claims and the linked local project take precedence. Otherwise, the CLI uses
the signed-in account to find the team and `vercel-sandbox-default-project`.

Preview that same configuration without creating anything:

```sh
vercel sandbox create --enable-github-credentials --dry-run
```

The preview uses saved credentials and read-only API lookups. It never logs in,
refreshes a token, or creates a missing default project. If no default project
exists, link an existing project or create the default project separately.
Normal creation retains its existing default-project setup behavior.

That one flag selects the complete default experience: the repository, clone
source, commit credit, and GitHub API actor are inferred, the default API
action set is requested, and Git write access is included. The CLI shows the
whole proposal before asking for approval. In interactive use, it asks again if
the project has no Bounds.

A bare `vercel sandbox create` is unchanged. Running inside a Git repository is
never on its own a request for repository access.

## GitHub access presets

A preset is a fixed permission set. Use `--github-access` to select one for the
inferred repository:

```sh
vercel sandbox create --github-access=read
vercel sandbox create --github-access=write
```

| Preset  | Git access  | GitHub API actions                                                 |
| ------- | ----------- | ------------------------------------------------------------------ |
| `read`  | `git:read`  | `pull-request:get`, `issues:read`, `labels:read`, `ci-status:read` |
| `write` | `git:write` | All 11 currently supported GitHub API actions                      |

Each preset replaces the default API action set. It selects both Git and API
permissions, but never adds workflow-file write access. The sets do not expand
automatically when the SDK adds an action.

Use `--credentials-github-repo` to select a different repository. The read preset
does not infer a commit name or email. Do not combine
`--credentials-github-commit-as` with `--github-access=read`.

Do not combine `--github-access` with `--credentials-github-action`,
`--credentials-github-from-config-file`, `--credentials-github-from-sandbox`, or
`--credentials-github-no-write`. Choose a preset, explicit flags, or a complete
configuration instead. Conflicts are rejected before authentication or file
input.

To change API actions, reject the proposal and edit the printed command. Rejected
commands expand presets into explicit permissions and preserve the selected Git
access. Running the printed command does not add inferred defaults.

## How a request is assembled

```text
flags / Git / gh / Vercel account
             |
             v
     complete proposal <--- configuration file or copied Sandbox
             |
             v
    Create this sandbox? (y/n)
         |              |
         n              y
         |              |
 print explicit      check project Bounds
 flags and exit      (ask again if none)
                        |
                        v
                  Sandbox.create
                        |
                        v
              optional configuration save
```

Rejecting a proposal prints the exact explicit-flags command. Edit that command
and run it again to preview a new proposal. There is no interactive editing menu.
Approval refers only to the proposal shown by that invocation.

## Inference

Inference runs before any question is asked. Explicit values always win.

| Value         | Inferred from                                                                   |
| ------------- | ------------------------------------------------------------------------------- |
| Team          | the effective Vercel team context                                               |
| Project       | the effective Vercel project context                                            |
| Repository    | local Git remotes, preferring `origin`                                          |
| Clone source  | the same repository as the credential request                                   |
| Commit credit | the **effective** local Git configuration, including repository-local overrides |
| API actor     | the active `gh` account, then the GitHub account linked to Vercel               |

### Repository

HTTPS and SSH `github.com` remotes are both recognized. Override with
`--credentials-github-repo OWNER/REPO`, which also becomes the clone source — in
single-repository mode there is no separate source flag to pass.

### API actor

1. An explicit `--credentials-github-act-as` wins.
2. Otherwise `gh` takes precedence.
3. Vercel's linked GitHub identity is queried **only** when `gh` is not logged
   in.

Only read-only `gh` metadata is used (`gh auth status`, `gh api user`). The CLI
never retrieves a GitHub token or passes one to the sandbox.

If a logged-in `gh` fails transiently, the command fails. It does not quietly
fall through to a different account — that would grant access as the wrong
user.

Vercel's fallback reads `GET /v1/integrations/account-links` and accepts only
the default `github.com` OAuth **login** connection. Another provider, an
enterprise host, a limited connection, or an ambiguous account list is treated
as unknown, and the CLI asks for `--credentials-github-act-as` instead of guessing.

`--credentials-github-act-as` accepts a username (with or without `@`) or a numeric
user ID. When `gh` reports a numeric ID, the CLI authorizes with that immutable
ID while displaying the readable login, so a later rename cannot redirect the
grant.

### Commit credit is not identity

Commit credit and the API actor are separate fields, shown separately in the
review. Git `user.name` and `user.email` are caller-supplied metadata — not
proof of GitHub identity, and not proof of permission.

## Review and approve

The review uses three columns: the setting, its value, and where the value came
from. Every field has a source, including the team, project, API permissions,
API actor, Git access, commit credit, and resource allocation. Sources identify
explicit flags, linked configuration, token claims, account defaults, or imported
configuration. Long values wrap within their column without hiding requested rights.

Each repository's API access has one actor row with a GitHub username. The request
still uses its original authorization selector, including a numeric ID when available.
If a numeric selector has no matching username metadata, the review shows
`GitHub username unavailable`. It never guesses another account or displays an
ID as a username. Configuration input sources appear in the source column rather
than as a separate Sandbox setting.

The creation prompt is:

```text
Create this sandbox? (y/n)
```

Answer `y` or `yes` to approve. Answer `n`, press Enter, or give another answer to
cancel. Cancellation prints the full explicit-flags command and exits 130 before
Sandbox creation. To change a value, edit that command and run it again.

### Confirm a project with no Bounds

After you approve the proposal, the CLI checks whether the selected project has
any Bounds. Bounds set a project-wide limit on managed-credential access. If
there are no Bounds, there is no such limit.

For a project with no Bounds, the CLI prints a warning and asks:

```text
Continue without project Bounds? (y/N)
```

Answer `y` or `yes` to continue. Any other answer cancels before creation and
prints the editable command described below. The Sandbox still receives only
the rights shown in the proposal. No Bounds does not automatically give that
Sandbox every permission.

The `--yes` option accepts both confirmations, but the warning still appears.
With `--json --yes`, the warning is one JSON object on stderr, with
`reason: "project_has_no_bounds"`. The created result on stdout is unchanged.

The check uses the final approved team and project. It reads all relevant pages
before deciding that no Bounds exist. If the CLI cannot read the policy, it
stops instead of treating the failed lookup as an empty policy. The current
token must have permission to read the project and its team's Bounds.

The check is read-only. It does not create, change, or remove Bounds. The
backend change that treats no Bounds as no project-wide limit is separate.

### Reject and correct the command

If you reject a complete proposal, the CLI prints its full explicit-flags command
to stderr. Edit that command and run it again. The command uses the exact
reviewed values rather than repeating the original guesses.

For example, rejecting an inferred proposal can print:

```sh
vercel sandbox create \
  --scope=team_example \
  --project=prj_example \
  --vcpus=6 \
  --credentials-github-repo=acme/widgets \
  --credentials-github-action=github:issues:read \
  --credentials-github-action=github:issues:comment \
  --credentials-github-action=github:pull-request:create \
  --credentials-github-act-as=42 \
  '--credentials-github-commit-as=Grace Hopper <grace@example.com>'
```

The output preserves `create`, `run`, or `sh`, along with the original command
arguments. It does not add `--yes`, so running it still requires approval.
Rejection exits with code 130 and creates no sandbox, grant, policy change, or
local file.

Tokens, environment values, and request-header values use required environment
variable placeholders instead of their original values. Set those variables
before running the printed command. Do not paste secrets into shared logs.

If direct flags cannot express the configuration, the output includes its
resolved JSON and a temporary-file command. Only running that command creates the
private temporary file. The command removes that file on exit and leaves stdin
available for other inputs. It does not read permissions from the original
configuration file or Sandbox again.

In JSON mode, a consent-required error includes the command in `data.command`.
No extra plain text is added to JSON output. The command retains the reviewed team and project.

## Git access and commit credit

Explicit `--credentials-github-action` flags change API access only.
`--github-access` selects both Git and API access:

- Without a preset, Git write (`git:write`) is the default for a managed source.
- `--credentials-github-no-write` requests a read-only clone (`git:read`) instead. It
  does not remove requested API permissions and does not turn API writes into
  reads.
- A read-only configuration omits the inferred commit credit entirely, since
  the sandbox cannot make commits.

Overriding API actions with `--credentials-github-action` never changes Git access:

```sh
# Narrower API access, Git write unchanged
vercel sandbox create --credentials-github-action issues:read

# Full default API access, read-only clone
vercel sandbox create --enable-github-credentials --credentials-github-no-write
```

Workflow-file write access is never requested by default.

### API actions

The default set is exactly:

```
issues:read
issues:comment
pull-request:create
```

Supplying any `--credentials-github-action` **replaces** that set rather than adding
to it, so a deliberately narrow request is never widened. Repeat the flag to
request several actions; comma-separated lists and duplicates are rejected.

Short names map to canonical GitHub action names (`issues:read` →
`github:issues:read`). To request **no** API actions, use a configuration file
with an empty `github` array — there is no separate "none" flag.

## Configuration files

Direct flags describe one repository. Multiple repositories, differing action
sets, or multiple identities belong in a configuration file:

```sh
vercel sandbox create --credentials-github-from-config-file config.json
```

```json
{
  "source": { "repo": "vercel/infra" },
  "commitAs": { "name": "John Fakenameson", "email": "madeup@example.org" },
  "credentials": {
    "github": [
      {
        "repo": "vercel/infra",
        "actions": ["git:read"],
        "actAs": "@some-alias"
      },
      {
        "repo": "vercel/front",
        "actions": ["issues:comment", "pull-request:create"],
        "actAs": "@fake-alias"
      },
      {
        "repo": "vercel/another-repo",
        "actions": ["issues:read"],
        "actAs": 123456
      }
    ]
  }
}
```

A file states the access it wants. The CLI never injects the default API
actions or Git write into it, and never merges a file with the direct flags —
combining them is an error rather than an implicit union of permission sets.

In this example `commitAs` has **no effect**: the source holds only
`git:read`, and commit metadata is inert without Git write. It is preserved in
the file and shown in the review as having no effect, but it never upgrades
access.

Notes:

- `actAs` accepts a username or a numeric ID, including a JSON number. A number
  beyond 2^53-1 loses precision, so it is rejected. This CLI also limits string
  IDs to safe integers.
- Git access is requested through the source, so `git:read`/`git:write` may only
  appear on the source repository. Asking for Git access on another repository
  is an error rather than a silently dropped request.
- A group must list at least one action. Granting nothing is expressed with an
  empty `github` array.
- Files are UTF-8 JSON, at most 64 KiB, at most 25 distinct repositories
  including the source. `-` reads stdin (bounded to 30 seconds).
- Raw passwords, tokens, and unknown fields are rejected.

See [`managed-credentials.example.json`](./managed-credentials.example.json).

## Reusing a configuration

### Persist to a file

```sh
# Writes $PWD/<sbx_id>-credentials.json
vercel sandbox create --enable-github-credentials --credentials-github-persist-configuration

# Writes an explicit path
vercel sandbox create --enable-github-credentials \
  --credentials-github-persist-configuration=./widgets-credentials.json
```

The path is attached with `=`. A bare `--credentials-github-persist-configuration`
uses the default name, so `--credentials-github-persist-configuration path.json`
would leave `path.json` as a separate argument; the CLI detects that and says
so.

The file is written **after** a successful creation and round-trips through
`--credentials-github-from-config-file`. The default name uses the `sbx_*` session
identifier the creation response returned — the same identifier
`--credentials-github-from-sandbox` accepts.

An existing file is never overwritten: the CLI reports the path and stops. If
the write fails, the error names the sandbox that was already created; the CLI
never creates a second sandbox to retry a local write.

### Copy from another sandbox

```sh
vercel sandbox create --credentials-github-from-sandbox sbx_132456789
vercel sandbox create --credentials-github-from-sandbox my-sandbox
```

Both names and `sbx_*` identifiers are accepted, resolved through an
authorized read-only lookup. The source sandbox is never resumed and no command
is run in it just to read its configuration.

Reuse copies **configuration, not authorization**. Tokens, grant IDs,
attestations, and the original creator's approval are never copied, and consent
and permissions are rechecked for the new sandbox and target context.

> Reading a configuration back from an existing sandbox requires the Sandbox API
> to report the managed-credential request it was created with. Against a
> deployment that does not return it, the CLI reports that there is nothing to
> reuse rather than inventing a configuration.

## Resources

Managed-credential creations default to **6 vCPUs**. This is a workaround, not
a performance choice: that size does not come from the warm pool, and managed
Git initialization currently fails on warm-pool instances. A default-capacity
creation (`sandbox-2cpu-4gb`) failed to clone a private repository with
"could not read Username", while the same image at six vCPUs cloned it
successfully with a read-only Git grant.

An explicit `--vcpus` takes precedence, and the review shows the effective
allocation. Ordinary creation defaults are unchanged.

## Safety rules

A Bound sets a project-wide access limit. A Grant gives one particular Sandbox
access to one repository. The CLI reads whether Bounds exist, but it never
creates or changes them:

- If Bounds exist, the API enforces them. The CLI does not add missing Bounds.
- If no Bounds exist, the CLI warns that there is no project-wide limit and asks
  for a second confirmation. The warning does not change the requested grants.
- If the policy cannot be read, the command stops. A failed lookup never means
  that access is unrestricted.

Also enforced:

- `--dry-run` performs no permission mutation, sandbox or grant creation, token
  refresh, or configuration write.
- Creation is never retried automatically, and neither are policy writes.
- Raw GitHub tokens never enter sandbox environment variables, Git URLs,
  exported configuration, logs, or CLI output.
- Git read is never broadened to write to work around a backend limitation.
- After a failure, existing policy is not rolled back and unrelated resources
  are not deleted.
- If the creation outcome is uncertain, inspect the Sandbox list before retrying.
  A failed response does not prove that the server created no resources.

## Non-interactive use and JSON

`--json`, CI, piped input, and `--non-interactive` never prompt. In those modes
a managed-credentials request needs `--yes`, which grants consent — never a
missing input or a missing permission. `--silent` does not suppress the review
or bypass consent.

One approval covers creation and the clearly displayed project-policy
additions. `--enable-github-credentials` selects defaults; it is not itself
approval.

Success writes one JSON document to stdout with `sandbox.name`, `session.id`,
`session.status`, `outcome: "created"`, a `configuration.path` when a
configuration was persisted, and a `next` verification command. Errors write
JSON to stderr and leave stdout empty. Input errors exit 2, operational
failures exit 1, cancellation exits 130.

With `--json`, `--dry-run` writes `outcome: "dry_run"` and the resolved configuration.
It can read account and Sandbox metadata through the API. It never refreshes
credentials, starts login, creates a default project, or writes a configuration file.
Scope can come from explicit flags, local project configuration, OIDC claims, or
read-only lookup of the signed-in account's existing default Sandbox project.
Login alone cannot select a project that does not exist.

`run` and `sh` accept the same creation inputs but not `--dry-run`, which does
not produce a sandbox to run in. `exec`, `connect`, and `fork` do not accept
credential mutations.

## Testing locally

From the repository root:

```sh
pnpm --filter @vercel/sandbox build
pnpm --filter sandbox build
node packages/sandbox/bin/sandbox.mjs create --help
```

Preview a configuration without creating anything:

```sh
node packages/sandbox/bin/sandbox.mjs create --enable-github-credentials --dry-run
```

Use the built binary by its full path to keep another directory as the working
directory, which is what inference reads. It uses saved Vercel login
credentials, or `VERCEL_TOKEN`.

### Managed Git behavior in the sandbox

Managed Git wraps `clone`, `fetch`, `pull`, and `push`; it does not add
credentials to `git ls-remote`. Signed push does not accept `git -C ... push`
or mapped refspecs. For a new branch, track the remote base branch and push the
branch by name:

```sh
git checkout -b my-branch --track origin/main
git push origin my-branch
```

GitHub pull-request listing through the broker requires `state=open` or
`state=all`, for example `GET /repos/acme/widgets/pulls?state=open&per_page=1`.
A list request without `state` is denied even with pull-request read access.

The sandbox's working directory comes from the image (`/vercel` for the default
image); deferred cloning uses that actual directory rather than a hardcoded
path.
