# Managed credential inputs (experimental)

These inputs require the API fields from vercel/api#102202 and the project's
managed credential feature gates. They are hidden until
`__VERCEL_SANDBOX_MANAGED_CREDENTIALS=1` is set. This local opt-in does not grant
API access or enable the server-side feature gates.

## Test locally

From the repository root, build the SDK and CLI:

```sh
pnpm --filter @vercel/sandbox build
pnpm --filter sandbox build
export __VERCEL_SANDBOX_MANAGED_CREDENTIALS=1
node packages/sandbox/bin/sandbox.mjs create --help
```

Use the built binary by its full path to keep another directory as the working
directory. It uses saved Vercel login credentials, or `VERCEL_TOKEN`. Nothing
needs to be installed globally. This is the shared CLI that `vercel sandbox`
delegates to; an already-installed Vercel CLI still uses its published version.

## One credential group: repeated options

```sh
node packages/sandbox/bin/sandbox.mjs create --scope acme --project acme-web --git-source https://github.com/acme/widgets.git --commit-as-name "Grace Hopper" --commit-as-email grace@example.com --github-repository acme/widgets --github-action github:issues:read --github-action github:pull-request:create --github-act-as 42
```

`--commit-as-name` and `--commit-as-email` must be supplied together. Instead,
`--commit-as-me` reads `git config --global user.name` and
`git config --global user.email`. It fails if either is missing and cannot be
combined with either explicit commit identity option. The repository's local
Git configuration does not override these global settings. All three options
require an HTTPS GitHub source and request managed Git access (`git:write`) for
that source. The commit identity is metadata, not proof of identity or consent.

Each `--github-repository` and `--github-action` appends one value. Every listed
repository receives every action, with a single shared identity. Duplicates,
empty values, comma-separated lists, and repeated scalar options are errors.
Use `--file` for different actions or identities on different repositories.

`--github-act-as` accepts a numeric GitHub user ID, not a username. When omitted,
the API uses the direct caller's connected GitHub account where available.
It never uses the commit identity as the API identity.

Use a direct-user Vercel personal token with access to the test team for GitHub
API requests. It can establish the individual Grant consent during creation.
A delegated CLI App login cannot infer `actAs` and does not provide that
consent automatically. With an explicit `--github-act-as`, creation can
succeed while API requests are denied until the represented user consents.
Do not pass a GitHub token into the Sandbox.

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
A list request without `state` is denied, even with pull-request read access.

For tooling without initial repository grants or a source:

```sh
node packages/sandbox/bin/sandbox.mjs create --scope acme --project acme-web --github
```

This sends `credentials: { github: [] }`. Omitting `--github` and all GitHub
credential options omits that field. Credential options imply `--github`.
`--no-github` (or `--github=false`) omits GitHub API forwarding and conflicts
with credential options. It does not disable managed Git requested by a commit
identity. `--github` also enables managed Git tooling when signed commits are
enabled, but does not make the initial source clone managed.

## Multiple credential groups: JSON file

```sh
node packages/sandbox/bin/sandbox.mjs create --scope acme --project acme-web --file packages/sandbox/docs/managed-credentials.example.json
```

The file accepts only `source`, `commitAs`, and `credentials`, using API field
names. Team, project, token, and sandbox name stay in their existing CLI options.
The CLI never automatically discovers this file or merges its permission sets
with options. `--file` conflicts with all new source/credential options, including
`--no-github`. A `source` in the file conflicts with `--snapshot`.

Git sources support `url`, optional `revision`, and optional positive `depth`.
Tarball and snapshot sources use their API shapes. Raw passwords, tokens,
`source.credentials`, legacy `__*` fields, and unknown fields are rejected.
A snapshot source cannot be combined with a runtime, image, or agent shortcut.
An empty file object supplies no credentials; an explicit empty `github` array
enables tooling without initial grants. Files are UTF-8 JSON, at most 64 KiB.

For generated input, `--file -` reads stdin (bounded to 30 seconds):

```sh
node packages/sandbox/bin/sandbox.mjs create --scope acme --project acme-web --file - --yes --json < packages/sandbox/docs/managed-credentials.example.json
```

## Consent, results, and lifecycle

Managed access requests preview the team, project, repositories, actions, and
identities, including implicit Git write access and sandbox access restrictions.
Interactive confirmation defaults to No. Non-interactive runs require `--yes`;
it grants consent, never missing inputs or permissions. `--silent` does not
suppress the access preview or bypass consent. Credential expiry remains
server-managed; this input has no expiry field.

`--json` is supported on `create`, disables prompts, and does not grant consent.
Success writes one JSON document to stdout with `sandbox.name`, `session.id`,
`session.status`, `outcome: "created"`, and a `next` verification command.
It never echoes credentials, environment variables, or the request document.
Errors write JSON to stderr, leaving stdout empty. New input errors exit 2,
operational failures exit 1, and cancellation exits 130. `--json` conflicts with
`--silent`, `--connect`, and interactive agent shortcuts. `run` and `sh` keep
their child-process streams instead of accepting `--json`.

`run` accepts the same creation inputs for a new sandbox. If its `--name` already
exists, it rejects them before resuming or executing, rather than silently
ignoring them. `exec`, `connect`, and `fork` do not accept credential mutations.
Creation requests are not retried automatically, including after auth failures.
After an uncertain result, inspect the sandbox list before creating another one.

These inputs do not provide a command to grant access later. An empty initial
list merely preserves the API's ability to accept repository grants later.
