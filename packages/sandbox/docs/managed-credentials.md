# Managed credentials (experimental)

Managed credentials let a sandbox clone a private GitHub repository and call
the GitHub API without a raw GitHub token ever reaching the sandbox, the CLI's
output, or an exported configuration file. Vercel brokers the access.

These inputs require the server-side managed credential feature gates and
permissions for the project. The flags are available without a local opt-in.

The unified action contract follows [API PR #103992](https://github.com/vercel/api/pull/103992).
The backend must support that contract before these requests can create a Sandbox.
The CLI does not deploy backend support or retry a rejected request with older fields.
Configuration reuse also requires the API to return request metadata.

Only GitHub is supported today. GitHub-specific flags use the
`--credentials-github-*` namespace. Other providers can use their own namespace
without changing these flags.

## Contents

- [Quick start](#quick-start)
- [Requesting access](#requesting-access)
- [Inference](#inference)
- [Review, approval and Bounds](#review-approval-and-bounds)
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

That flag infers the repository, clone source, and GitHub actor. It requests
`git:write`, `github:issues:read`, `github:issues:comment`, and
`github:pull-request:create`. The broker derives Git commit attribution from
the selected actor. The CLI does not read local Git name or email for this request.

A bare `vercel sandbox create` is unchanged. Running inside a Git repository is
never on its own a request for repository access.

`--scope` and `--project` are optional when the CLI can discover them. Explicit
flags win; otherwise OIDC claims and the linked local project take precedence,
then the team saved by `vercel switch`, then the account default. Within that
team the CLI selects `vercel-sandbox-default-project`. A failed lookup for the
saved team stops the command rather than selecting another team. `vercel switch`
does not select a project; use `--project` or a local project link for that.

Preview the same configuration without creating anything:

```sh
vercel sandbox create --enable-github-credentials --dry-run
```

The preview uses saved credentials and read-only API lookups. It never logs in,
refreshes a token, or creates a missing default project. If no default project
exists, link an existing project or create the default project separately.
Normal creation retains its existing default-project setup behavior.

## Requesting access

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

Every permission travels in `credentials.github[].actions`. The clone source
contains only clone options; the CLI never sends `source.credentials`.

### Presets

A preset is a fixed permission set for the inferred repository:

```sh
vercel sandbox create --github-access=write
```

The write preset requests `git:write` and all 11 supported GitHub API actions.
It does not request `git:write-workflows`. New SDK actions never expand this set.

Do not combine `--github-access` with explicit actions, configuration input,
or `--credentials-github-no-write`. Choose one complete source of permissions.
A rejected write preset expands into explicit action flags for replay.

### Explicit actions

Explicit `--credentials-github-action` flags replace the entire default set.
They do not preserve implicit Git write or add omitted API actions:

```sh
vercel sandbox create \
  --credentials-github-action=git:write \
  --credentials-github-action=github:pull-request:create
```

This requests exactly those two actions. A Git-only request is also valid. An
API-only request does not gain Git permission, so an inferred clone can fail if
a private source requires Git access the request does not include. Use a
complete configuration without `source` when no initial clone is wanted.

The supported Git actions are `git:write` and `git:write-workflows`.
Workflow-file writes require the latter explicitly; normal writes never imply it.
The current creation contract does not accept `git:read`, so the CLI rejects
`--github-access=read` and `--credentials-github-no-write` before inference. It
never substitutes write access for an unsupported read request.

GitHub API actions accept short aliases such as `issues:read` and canonical
names such as `github:issues:read`. Git actions retain their `git:` prefix.
Repeat the flag for multiple actions. Comma-separated lists, duplicates, and
unknown actions fail before authentication.

Git-only groups, groups without a source, and groups for multiple repositories
retain their selected actions and actors. The CLI does not move Git rights onto
the source or require the source to match every credential group.

## Inference

Inference runs before any question is asked. Explicit values always win.

| Value         | Inferred from                                                     |
| ------------- | ----------------------------------------------------------------- |
| Team          | the effective Vercel team context                                 |
| Project       | the effective Vercel project context                              |
| Repository    | local Git remotes, preferring `origin`                            |
| Clone source  | the same repository as the credential request                     |
| Commit credit | the broker derives it from the selected GitHub actor              |
| GitHub actor  | the active `gh` account, then the GitHub account linked to Vercel |

### Repository

HTTPS and SSH `github.com` remotes are both recognized. Override with
`--credentials-github-repo OWNER/REPO`, which also becomes the clone source — in
single-repository mode there is no separate source flag to pass.

### GitHub actor

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

### Commit attribution

The same `actAs` selects the GitHub identity for Git actions and API actions.
The broker derives the Git name and email. A local Git name or email does not
select or prove that identity.

`--credentials-github-commit-as` remains a deprecated explicit override.
The CLI never infers it. It only accepts an override when one writing repository
matches the clone source and explicitly requests `git:write`. Ambiguous overrides
fail instead of adding permissions or applying one identity across repositories.

## Review, approval and Bounds

The review uses three columns: the setting, its value, and where the value came
from. Every field has a source, including the team, project, complete action sets,
GitHub actor, commit attribution, and resource allocation. Sources identify
explicit flags, linked configuration, token claims, account defaults, or imported
configuration. Long values wrap within their column without hiding requested rights.

The CLI looks up team and project names through read-only requests. These names
are for display only; API requests keep the selected IDs and token. If a lookup
fails, the review keeps the ID and adds `name lookup unavailable` to the From
column. Name lookup does not replace or skip the Bounds check.

Each repository's requested actions have one actor row with a GitHub username. The request
still uses its original authorization selector, including a numeric ID when available.
If a numeric selector has no matching username metadata, the review shows
`GitHub username unavailable`. It never guesses another account or displays an
ID as a username. Configuration input sources appear in the source column rather
than as a separate Sandbox setting.

Answer `y` or `yes` at `Create this sandbox? (y/n)` to approve. Any other answer,
including Enter, cancels: the CLI prints the editable command below and exits 130
before creating anything. There is no interactive editing menu, and approval
refers only to the proposal that invocation showed.

### Project Bounds

A Bound sets a project-wide limit on managed-credential access; a Grant gives one
particular Sandbox access to one repository. The CLI reads whether Bounds exist
but never creates or changes them:

- If Bounds exist, the API enforces them. The CLI does not add missing Bounds.
- If no Bounds exist, the CLI warns that there is no project-wide limit and asks
  `Continue without project Bounds? (y/N)`. Any answer other than `y` or `yes`
  cancels before creation. The Sandbox still receives only the rights shown in
  the proposal: no Bounds does not give it every permission.
- If the policy cannot be read, the command stops. A failed lookup never means
  that access is unrestricted.

The check runs after approval, using the final approved team and project, and
reads all relevant pages before deciding that no Bounds exist. It is read-only.
The current token must be able to read the project and its team's Bounds: a
project OIDC token can identify the right scope but still receive HTTP 403 from
those endpoints, and the CLI stops in that case rather than treating inaccessible
policy as absent. A Vercel user login can read these endpoints given permission.

`--yes` skips the parameter review and accepts both confirmations. It does not
disable the Bounds check or hide warnings and errors. With `--json --yes`, the
warning is one JSON object on stderr with `reason: "project_has_no_bounds"`; the
created result on stdout is unchanged.

### Reject and correct the command

Cancelling prints the proposal's full explicit-flags command to stderr. Edit it
and run it again. The command uses the exact reviewed values rather than
repeating the original guesses:

```sh
vercel sandbox create \
  --scope=team_example \
  --project=prj_example \
  --vcpus=6 \
  --credentials-github-repo=acme/widgets \
  --credentials-github-action=github:issues:read \
  --credentials-github-action=github:issues:comment \
  --credentials-github-action=github:pull-request:create \
  --credentials-github-action=git:write \
  --credentials-github-act-as=42
```

The output preserves `create`, `run`, or `sh`, along with the original command
arguments. It does not add `--yes`, so running it still requires approval.
Rejection creates no sandbox, grant, policy change, or local file.

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

## Configuration files

Direct flags describe one repository. A file uses the API's managed-credential
fields, not a separate CLI format. Groups can contain multiple repositories
with the same action set and actor:

```sh
vercel sandbox create --credentials-github-from-config-file config.json
```

```json
{
  "source": { "type": "git", "url": "https://github.com/vercel/infra.git" },
  "credentials": {
    "github": [
      {
        "repositories": ["vercel/infra", "vercel/tools"],
        "actions": ["git:write"],
        "actAs": "@some-alias"
      },
      {
        "repositories": ["vercel/front"],
        "actions": ["github:issues:comment", "github:pull-request:create"],
        "actAs": "@fake-alias"
      },
      {
        "repositories": ["vercel/another-repo"],
        "actions": ["github:issues:read"],
        "actAs": "123456"
      }
    ]
  }
}
```

The file contains the managed-credential portion of a Sandbox creation request:
`source`, `credentials`, and an optional deprecated `commitAs`. Team, project,
resources, and other creation fields still come from CLI flags or context.
The same managed fields can be included in an API creation request unchanged.

The CLI preserves source options, repository arrays, group order, actions, and
actors during creation, persistence, and replay. It does not regroup permissions
or rename fields. Old `source.repo` and group `repo` fields are rejected.

A file states the access it wants. The CLI never injects default permissions or
merges it with direct credential flags. Combining them is an error. Each group
selects its GitHub actor independently, and the broker derives attribution for
Git writing from that actor. An optional `source` only selects the initial
checkout; omitting it does not remove credential groups or their actions.

Notes:

- Files require canonical API values. Actions use their full names, such as
  `github:issues:read`. `actAs` is an `@`-prefixed username or a quoted numeric
  ID. Short action names, bare usernames, and numeric JSON actors are rejected.
  Convenience aliases remain available in command-line flags.
- Each group must list at least one repository and action. Duplicate entries
  are rejected. Granting nothing is expressed with an empty `github` array.
- A managed source uses `type: "git"` and a GitHub HTTPS URL. URLs with embedded
  credentials, query parameters, or fragments are rejected.
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

The API-shaped file is written **after** successful creation and round-trips
through `--credentials-github-from-config-file` without field translation. The default name uses the `sbx_*` session
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

Beyond the Bounds rules above:

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
missing input or a missing permission. `--silent` alone does not suppress the review
or bypass consent. One approval covers creation with the displayed rights; it
does not change project-wide policy. `--enable-github-credentials` selects
defaults, not consent.

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
