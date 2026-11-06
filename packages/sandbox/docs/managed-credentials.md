# Managed credentials (experimental)

Vercel brokers Git and GitHub API access without exposing a raw GitHub token in
the sandbox, CLI output, logs, Git URLs, or exported configuration. Only GitHub is
supported; its flags use `--credentials-github-*` so other providers can have
separate namespaces.

## Quick start and scope

Sign in with `vercel login`, then run inside a GitHub repository:

```sh
vercel sandbox create --enable-github-credentials
```

The enable flag infers the repository, clone source, and GitHub actor.
The defaults are `git:write`, `github:issues:read`, `github:issues:comment`, and
`github:pull-request:create`. A bare `create` is unchanged: local Git context
alone never requests access. `run` and `sh` accept the same creation inputs;
`exec`, `connect`, and `fork` do not accept credential mutations.

Explicit team (`--scope`) and project (`--project`) selectors win. Otherwise,
the CLI uses OIDC claims, a linked local project, or account-based selection,
never `vercel switch`.
Authentication and selection happen before review and can refresh credentials or
create a missing default project. The CLI resolves one complete proposal before
approval, then checks Bounds, creates the sandbox once, and optionally saves its
configuration. There is no separate dry-run mode.

## Actions and identity

Every permission is in `credentials.github[].actions`. Explicit repeated
`--credentials-github-action` flags replace the entire default set, including Git
access. API-only requests gain no implicit Git access; cloning a private source
can therefore fail. Use a configuration without `source` when no clone is wanted.

```sh
vercel sandbox create --credentials-github-action=git:write \
  --credentials-github-action=github:pull-request:create
```

Flags accept `issues:read` or `github:issues:read`; Git actions keep `git:`.
Comma-separated lists, duplicates, unknown actions, and missing flag values fail
before authentication. `git:write-workflows` is required explicitly for workflow
files. `git:read` is unsupported and is never replaced with write access.

The CLI infers GitHub HTTPS or SSH fetch remotes, preferring `origin`.
`--credentials-github-repo OWNER/REPO` overrides inference and also selects the
clone source. Direct flags describe one repository; files can describe many.
Git-only groups and groups without a source retain their actions and actors.
Git rights are not moved to the source, which need not match every group.

Actor precedence is explicit `--credentials-github-act-as`, active `gh` account,
then Vercel's linked GitHub account. Flags accept bare or `@`-prefixed usernames
and numeric IDs. `gh auth status` and `gh api user` read only account metadata,
never a token. A transient `gh` failure stops the command instead of selecting
another account. Only an absent login permits the Vercel fallback.

That fallback reads `GET /v1/integrations/account-links` and requires one default
`github.com` OAuth login connection. Other providers, enterprise hosts, limited
connections, and ambiguous lists require an explicit actor instead of a guess.
When available, an immutable numeric ID authorizes the request while its matching
username is displayed, so an account rename cannot redirect the grant.

The same `actAs` selects Git and API identity. The broker derives the Git name
and email, not local Git configuration. No flag sets commit credit, and files
reject deprecated `commitAs` like any unknown field.

## Review, consent, and Bounds

`Inferred Parameters` shows Team, Project, Repo, Actions, and GitHub actor in two
columns with a dashed heading separator. Actions appear one per line, including
Git actions. Long values wrap without hiding rights. Sandbox name, Resources,
and a separate Commit credit row are omitted.

Multiple groups include repository names in action and actor values. A single
action target is named if it differs from the clone source or no source exists.
Name lookups are read-only display requests: they never replace selected API IDs,
authentication, or the Bounds check. Failed lookups retain IDs. Unmatched numeric
actors show `GitHub username unavailable`, never a guessed username or an ID
presented as a username.

Answer `y` or `yes` to `Create this sandbox? (y/n)` to approve that proposal.
Any other answer, including Enter, exits 130 before creation. There is no editing
menu. Rejection creates no Sandbox, Grant, policy change, or local file.

A Bound limits managed access for a project; a Grant gives one Sandbox access to
one repository. After approval, one project-scoped read resolves exact names or
IDs and returns all Bounds, with backend pagination. The token needs project
read access; verified user tokens and project-scoped OIDC tokens are supported.
The CLI never creates or changes Bounds. Existing Bounds are enforced by the API.

Without Bounds, the warning explains that no project-wide limit exists and asks
`Continue without project Bounds? (y/N)`. Only `y` or `yes` continues. The sandbox
still gets only the shown rights. An unreadable policy stops creation, never
means unrestricted access, and does not trigger creation of missing Bounds.

`--yes` skips review and accepts both confirmations, but never hides warnings,
errors, or the Bounds check. CI, piped input, non-terminal sessions, and detected
agents never prompt and require `--yes`; there is no `--non-interactive` flag.
Without consent, the CLI prints the proposal and stops. `--silent` does not skip
review or consent. `--yes` does not supply missing inputs or permissions, or change
project-wide policy. The enable flag selects defaults, not consent.

## Configuration files

Files use the API's managed-credential fields, not a separate CLI schema:

```sh
vercel sandbox create --credentials-github-from-config-file config.json
```

See [the complete multi-repository example](./managed-credentials.example.json),
which includes separate groups, actors, Git actions, and API actions.

| Field                              | Meaning                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `source`                           | Optional initial checkout; omitting it does not remove credentials |
| `source.type`, `source.url`        | `git` and a GitHub HTTPS repository URL                            |
| `source.revision`, `source.depth`  | Optional revision and clone depth                                  |
| `credentials.github`               | Groups of repositories, actions, and an optional actor             |
| `repositories`, `actions`, `actAs` | Each group's targets, complete rights, and GitHub identity         |

The file contains only `source` and `credentials`, which can be sent unchanged in
an API creation request. Team, project, resources, and other creation fields come
from CLI flags or context. Repository arrays, group order, source options,
actions, and actors survive creation, persistence, and replay without regrouping.
Each group selects its own actor, including Git attribution.

Files require full canonical action names and `actAs` as an `@username` or quoted
numeric ID. Short action aliases, bare usernames, numeric JSON actors,
`source.repo`, group `repo`, raw passwords/tokens, and unknown fields are rejected.
Each group needs at least one repository and action, with no duplicate entries.
An empty `github` array grants nothing. Embedded URL credentials, query
parameters, and fragments are rejected.

Inputs are UTF-8 JSON, at most 64 KiB and 25 distinct repositories including the
source. `-` reads stdin with a 30-second limit. Files supply complete access;
they receive no inferred permissions and cannot be combined with direct
credential flags. File and Sandbox inputs cannot be merged, or combined with
`--enable-github-credentials`.

## Export and Sandbox reuse

```sh
vercel sandbox create --enable-github-credentials \
  --credentials-github-persist-configuration=./credentials.json
vercel sandbox create --credentials-github-from-sandbox my-sandbox
```

Export requires an explicit path; relative paths use the working directory.
It writes API-shaped JSON after successful creation, readable through the file
input flag without translation. Existing files are never overwritten. A write
failure identifies the already-created sandbox and never creates another one to
retry the local write.

Reuse accepts a sandbox name or `sbx_*` identifier through an authorized,
read-only lookup. It never resumes the source or runs commands inside it.
Only configuration is copied, never tokens, grant IDs, attestations, or the
creator's approval. The new sandbox and target context require fresh consent and
permission checks. If the API omits the original request metadata, reuse reports
that no configuration is available rather than inventing one.

## Reject and correct

Eligible direct-flag or Sandbox inputs print `Edit these explicit commands as
desired`, followed by a `create` command containing appropriate flags.
It always uses `create`, even after `run` or `sh`, and omits the
child command, names, environment values, network options, and export path.
Add any other creation options you need. It never adds `--yes`.

Direct recovery uses `@username` only when validated metadata matches the
selected actor; otherwise it keeps the original selector, including a numeric
ID. This changes the suggestion, not the original configuration. Configuration
files and requests that direct flags cannot represent print no recovery command,
JSON block, or shell script. Edit the file and rerun its original command.

With an explicit original `--token`, recovery requires `VERCEL_AUTH_TOKEN` to
hold that same Vercel token through a non-printing placeholder. It never prints
the token or silently chooses another login. Do not paste secrets into logs.

## Resources and failure safety

Creation and policy writes are never retried automatically. Failure does not roll
back existing policy or delete unrelated resources. If creation is uncertain,
inspect the Sandbox list before retrying: a failed response does not prove that
nothing was created. Output is text. Validation errors exit 2, operational errors
exit 1, and cancellation exits 130.
