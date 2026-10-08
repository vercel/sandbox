# Vercel Sandbox CLI for Go

An experimental, binary-only Go port of the Vercel Sandbox CLI.

## Build

Go 1.26.1 or newer is required.

```bash
go build -o dist/sandbox ./cmd/sandbox
```

The package vendors the minimal generated `github.com/vercel/go-sdk` sources it
uses because that experimental repository is currently private. The vendored
copy is pinned to commit `6f426eaaf66f9d5140acc75cf717bfa4ccfeccba` and remains under its upstream
Apache-2.0 license.

## Authentication and scope

The CLI reuses the existing Vercel CLI login, including refreshing expired OAuth
credentials when possible. An explicit `--token`, `VERCEL_AUTH_TOKEN`, or
`VERCEL_OIDC_TOKEN` takes precedence. Team and project are inferred from a scoped
OIDC token, the nearest `.vercel/project.json`, or the Vercel CLI's current team;
otherwise pass them explicitly:

```bash
sandbox --scope team_id --project project_id list
```

## Core commands

```bash
sandbox create my-sandbox
sandbox create --connect
sandbox sh
sandbox list
sandbox exec my-sandbox -- npm test
sandbox connect my-sandbox
sandbox copy ./file.txt my-sandbox:/tmp/file.txt
sandbox copy my-sandbox:/tmp/file.txt ./file.txt
sandbox stop my-sandbox
```

Run `sandbox <command> --help` for options.

## Initial port scope

This first release focuses on `create`, `sh`, `list`, `exec`, `connect`, `copy`,
and `stop`. The TypeScript CLI remains the full-featured implementation. Deferred
commands include `run`, `fork`, `remove`, snapshots, sessions, drives,
configuration, telemetry, and interactive login/logout.
