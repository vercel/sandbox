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
the resolved access, identities, and provenance for confirmation before anything
is created. Rejecting prints the equivalent explicit-flags command so the
proposal can be edited and rerun; `--yes` approves without the review.
The CLI reuses its existing team and project selection. It does not read the
team selected by `vercel switch`.

Configurations are read from and persisted to API-shaped JSON files
(`source.type`, `source.url`, `credentials.github[].repositories`), and can be
reused from an existing Sandbox without resuming it or copying consent.
The confirmation preview replaces a separate dry-run mode. Normal authentication
and project selection happen before the preview. Project Bounds are read before
creation using the approved scope. An unreadable policy stops the command.
A project with no Bounds warns and requires a second confirmation.

The SDK gains managed Git and GitHub API credential request contracts and
optional nonsecret session request metadata, and no longer retries creation, so
an uncertain response cannot produce a duplicate Sandbox or grant.
