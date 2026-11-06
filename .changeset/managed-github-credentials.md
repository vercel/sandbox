---
"sandbox": minor
"@vercel/sandbox": minor
"@vercel/sandbox-mock": patch
---

Add managed GitHub credentials to `create`, `run`, and `sh`.

`--enable-github-credentials` requests short-lived Git and GitHub API access for
a Sandbox. The CLI infers the repository from local Git fetch remotes and the
API actor from `gh` or the default github.com OAuth login on the Vercel account,
applies explicit flags on top with `--credentials-github-*` options, and shows
the resolved actions and GitHub actor in the two-column `Inferred Parameters`
review before anything is created. Rejection prints a credentials-focused
`create` command only when direct flags can represent the configuration and the
input did not come from a configuration file. It does not print JSON or a shell
script. Other creation options must be added again.
An explicit Vercel token uses a required placeholder, never its value.
`--yes` approves without the review. The CLI detects non-interactive sessions
without a `--non-interactive` flag.
The CLI reuses its existing team and project selection. It does not read the
team selected by `vercel switch`.

Configurations are read from and persisted to API-shaped JSON files
(`source.type`, `source.url`, `credentials.github[].repositories`), and can be
reused from an existing Sandbox without resuming it or copying consent.
The confirmation preview replaces a separate dry-run mode. Normal authentication
and project selection happen before the preview. Project Bounds are read before
creation using one project-scoped request with backend selector resolution and
pagination. An unreadable policy stops the command.
A project with no Bounds warns and requires a second confirmation.

The SDK gains managed Git and GitHub API credential request contracts and
optional nonsecret session request metadata, and no longer retries creation, so
an uncertain response cannot produce a duplicate Sandbox or grant. Unreadable
successful responses require inspection before retrying. Credential flags reject
missing values, and configuration-reuse lookup errors use safe error messages.
Command output is text. JSON configuration input, file export, and Sandbox reuse
remain supported. Git attribution comes from `actAs`. The deprecated `commitAs`
field is not supported and is rejected in configuration files.

The CLI reads only account IDs and usernames for actor selection. Unused private
helpers, action exports, and persistence return values are removed. Configuration
and transport tests share coverage. The CLI handles display-name requests without
adding them to SDK authentication.

The preview labels the clone source as `Repo`, lists actions one per line, and
separates the column headings from the inferred parameter values.

Rejected previews print the matching GitHub username in direct actor flags when
available, with a numeric-ID fallback and the revised explicit-command message.

Removed unused metadata caching, repeated recovery validation, and source
selection bookkeeping. Tests share fixtures and failure setup.
