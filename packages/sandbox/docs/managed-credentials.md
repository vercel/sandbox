# Managed credentials (experimental)

Managed credentials let a sandbox clone a private GitHub repository and call
the GitHub API without a raw GitHub token ever reaching the sandbox, the CLI's
output, or an exported configuration file. Vercel brokers the access.

These inputs require the server-side managed credential feature gates and
permissions for the project. The flags are available without a local opt-in.

Only GitHub is supported today. The `--credentials-*` naming is deliberately
forge-neutral so NPM, AI Gateway, and Linear credentials can join the same
prefix later.

## Contents

- [Quick start](#quick-start)
- [How a request is assembled](#how-a-request-is-assembled)
- [Inference](#inference)
- [Review, edit, approve](#review-edit-approve)
- [Git access and commit credit](#git-access-and-commit-credit)
- [Configuration files](#configuration-files)
- [Reusing a configuration](#reusing-a-configuration)
- [Resources](#resources)
- [Safety rules](#safety-rules)
- [Non-interactive use and JSON](#non-interactive-use-and-json)
- [Legacy options](#legacy-options)
- [Testing locally](#testing-locally)

## Quick start

Run from inside a GitHub repository, with `gh` logged in:

```sh
vercel sandbox create --enable-managed-credentials
```

That one flag selects the complete default experience: the repository, clone
source, commit credit, and GitHub API actor are inferred, the default API
action set is requested, and Git write access is included. The CLI shows the
whole proposal and asks once before creating anything.

A bare `vercel sandbox create` is unchanged. Running inside a Git repository is
never on its own a request for repository access.

## How a request is assembled

```
                 ┌──────────────────────────┐
  flags ────────▶│                          │
                 │        inference         │──▶ proposed configuration
  local git ────▶│  (repo, commitAs, actor) │              │
  gh / Vercel ──▶│                          │              │
                 └──────────────────────────┘              │
                                                            ▼
  --credentials-from-config-file ──┐              ┌──────────────────┐
                                   ├────────────▶ │  review screen   │
  --credentials-from-sandbox ──────┘              │ Create/Edit/Cancel│
     (explicit: no defaults added)                └──────────────────┘
                                                      │         │
                                            edit ◀────┘         ▼ create
                                       (re-infer and             │
                                        re-check policy)         ▼
                                                        ┌──────────────────┐
                                                        │  Sandbox.create  │
                                                        └──────────────────┘
                                                                 │
                                                                 ▼
                                   --credentials-persist-configuration
                                        writes the configuration as JSON
```

Editing any value re-runs the inference that depended on it and recomputes the
permission check, so an approval always refers to what will actually be
created.

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
`--credentials-repo OWNER/REPO`, which also becomes the clone source — in
single-repository mode there is no separate source flag to pass.

### API actor

1. An explicit `--credentials-act-as` wins.
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
as unknown, and the CLI asks for `--credentials-act-as` instead of guessing.

`--credentials-act-as` accepts a username (with or without `@`) or a numeric
user ID. When `gh` reports a numeric ID, the CLI authorizes with that immutable
ID while displaying the readable login, so a later rename cannot redirect the
grant.

### Commit credit is not identity

Commit credit and the API actor are separate fields, shown separately in the
review. Git `user.name` and `user.email` are caller-supplied metadata — not
proof of GitHub identity, and not proof of permission.

## Review, edit, approve

The review shows the team and project, the source, each repository's API
actions, Git access, commit credit, the API actor, the resource allocation, the
configuration's origin, and any proposed project-wide policy additions.

Answer `c` to create, `e` to correct a value, or anything else to cancel.
Cancelling happens before any sandbox, grant, policy change, or local file is
written. An empty answer cancels.

Correctable values: team, project, repository, actions, commit credit, and API
actor. Correcting the team discards a project that was linked for the previous
team.

## Git access and commit credit

Git permission is decided **independently** of the API action set:

- Git write (`git:write`) is the default for a managed source.
- `--credentials-no-write` requests a read-only clone (`git:read`) instead. It
  does not remove requested API permissions and does not turn API writes into
  reads.
- A read-only configuration omits the inferred commit credit entirely, since
  the sandbox cannot make commits.

Overriding the API actions never changes Git access:

```sh
# Narrower API access, Git write unchanged
vercel sandbox create --credentials-action issues:read

# Full default API access, read-only clone
vercel sandbox create --enable-managed-credentials --credentials-no-write
```

Workflow-file write access is never requested by default.

### API actions

The default set is exactly:

```
issues:read
issues:comment
pull-request:create
```

Supplying any `--credentials-action` **replaces** that set rather than adding
to it, so a deliberately narrow request is never widened. Repeat the flag to
request several actions; comma-separated lists and duplicates are rejected.

Short names map to canonical GitHub action names (`issues:read` →
`github:issues:read`). To request **no** API actions, use a configuration file
with an empty `github` array — there is no separate "none" flag.

## Configuration files

Direct flags describe one repository. Multiple repositories, differing action
sets, or multiple identities belong in a configuration file:

```sh
vercel sandbox create --credentials-from-config-file config.json
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
  beyond 2^53-1 has already lost precision when parsed, so it is rejected;
  quote it as a string instead.
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
vercel sandbox create --enable-managed-credentials --credentials-persist-configuration

# Writes an explicit path
vercel sandbox create --enable-managed-credentials \
  --credentials-persist-configuration=./widgets-credentials.json
```

The path is attached with `=`. A bare `--credentials-persist-configuration`
uses the default name, so `--credentials-persist-configuration path.json`
would leave `path.json` as a separate argument; the CLI detects that and says
so.

The file is written **after** a successful creation and round-trips through
`--credentials-from-config-file`. The default name uses the `sbx_*` session
identifier the creation response returned — the same identifier
`--credentials-from-sandbox` accepts.

An existing file is never overwritten: the CLI reports the path and stops. If
the write fails, the error names the sandbox that was already created; the CLI
never creates a second sandbox to retry a local write.

### Copy from another sandbox

```sh
vercel sandbox create --credentials-from-sandbox sbx_132456789
vercel sandbox create --credentials-from-sandbox my-sandbox
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

A **Bound** is a project-wide access ceiling. A **Grant** gives one particular
sandbox access to one repository, within that ceiling. They are not the same
thing, and the CLI keeps them distinct:

- Only the minimal missing Bound additions are proposed, per repository, and
  they are shown as project-wide before approval.
- A policy lookup that fails is **unknown**, not an empty policy and not
  permission to add access. The CLI refuses to propose additions derived from
  an unreadable policy.
- Where no policy source is readable at all, the CLI proposes nothing and lets
  the server enforce the ceiling.

Also enforced:

- `--dry-run` performs no permission mutation, sandbox or grant creation, token
  refresh, or configuration write.
- Creation is never retried automatically, and neither are policy writes.
- Raw GitHub tokens never enter sandbox environment variables, Git URLs,
  exported configuration, logs, or CLI output.
- Git read is never broadened to write to work around a backend limitation.
- After a failure, existing policy is not rolled back and unrelated resources
  are not deleted.
- An HTTP 400 during creation can mean a VM was allocated and cloning failed
  afterwards, so the CLI preserves the failure category, exit status, request
  ID, and allocated session ID instead of reporting a clean rejection.

## Non-interactive use and JSON

`--json`, CI, piped input, and `--non-interactive` never prompt. In those modes
a managed-credentials request needs `--yes`, which grants consent — never a
missing input or a missing permission. `--silent` does not suppress the review
or bypass consent.

One approval covers creation and the clearly displayed project-policy
additions. `--enable-managed-credentials` selects defaults; it is not itself
approval.

Success writes one JSON document to stdout with `sandbox.name`, `session.id`,
`session.status`, `outcome: "created"`, a `configuration.path` when a
configuration was persisted, and a `next` verification command. Errors write
JSON to stderr and leave stdout empty. Input errors exit 2, operational
failures exit 1, cancellation exits 130.

`--dry-run` writes `outcome: "dry_run"` with the resolved configuration and
makes no API request.

`run` and `sh` accept the same creation inputs but not `--dry-run`, which does
not produce a sandbox to run in. `exec`, `connect`, and `fork` do not accept
credential mutations.

## Legacy options

The earlier `--git-source`, `--github*`, `--commit-as-*`, and
`--managed-credentials-file` options still work unchanged, and
`--managed-credentials-file` still reads its original transport-shaped format.
They cannot be combined with the `--credentials-*` options, which describe
access differently.

| Legacy                        | Replacement                              |
| ----------------------------- | ---------------------------------------- |
| `--git-source URL`            | `--credentials-repo OWNER/REPO`          |
| `--github-repository`         | `--credentials-repo`                     |
| `--github-action`             | `--credentials-action`                   |
| `--github-act-as`             | `--credentials-act-as`                   |
| `--commit-as-name` / `-email` | `--credentials-commit-as "Name <email>"` |
| `--commit-as-me`              | inferred by default                      |
| `--github`                    | `--enable-managed-credentials`           |
| `--managed-credentials-file`  | `--credentials-from-config-file`         |

Legacy creations keep the ordinary resource default; the six-vCPU default
applies to `--credentials-*` requests.

## Testing locally

From the repository root:

```sh
pnpm --filter @vercel/sandbox build
pnpm --filter sandbox build
node packages/sandbox/bin/sandbox.mjs create --help
```

Preview a configuration without creating anything:

```sh
node packages/sandbox/bin/sandbox.mjs create --enable-managed-credentials --dry-run
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
