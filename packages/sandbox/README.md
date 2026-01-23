# Vercel Sandbox CLI

Command line interface for Vercel Sandbox.

Read the full documentation at [vercel.com/docs/vercel-sandbox/cli-reference](https://vercel.com/docs/vercel-sandbox/cli-reference).

## Installation

```bash
pnpm i -g sandbox
```

## Usage

```bash
sandbox create # Create a new sandbox
sandbox ls # List your sandboxes
sandbox --help # View all commands
```

## SDK

For programmatic access to Vercel Sandbox, use the [`@vercel/sandbox`](https://www.npmjs.com/package/@vercel/sandbox) package instead:

```bash
pnpm add @vercel/sandbox
```

```ts
import { Sandbox } from "@vercel/sandbox";
```
