# 1Password Secrets Example

This example demonstrates how to inject 1Password secrets into a sandbox using secret references. It creates a sandbox with a secret resolved from 1Password, runs a command that uses it, and confirms the value is available in the environment.

## Features

- **Secret References**: Pass 1Password secret references (`op://vault/item/field`) in `env.secretsFrom1Password` when creating a sandbox
- **Environment Injection**: Resolved secrets are merged into the environment for every command run in the sandbox
- **Optional Env Var**: Read the reference from `OP_REF` in `.env.local` so you don't hardcode it in code
- **Authentication**: Uses `OP_SERVICE_ACCOUNT_TOKEN` for 1Password

## How to Run

1. Navigate to the example directory:

```bash
   cd examples/onepassword-secrets
```

2. Install dependencies:

```bash
   pnpm install
```

3. Set up authentication for Vercel Sandbox:

```bash
   vercel link
   vercel env pull
```

4. Alternatively

Set up 1Password: add OP_SERVICE_ACCOUNT_TOKEN to .env.local. Add your secret reference in .env.local with a single pair of quotes:

```bash
   OP_REF="op://Your Vault/Your Item/field name"
```

5. Run the example

```bash
   pnpm start
```

You should see output like:

- `Creating sandbox with 1Password secrets...`
- `Sandbox created. Running command that uses the secret...`
- `MY_SECRET is set: yes` and a non-zero length (e.g. `Length: 8`)
- `Done.`

If you see `MY_SECRET is set:` with nothing after it and `Length: 0`, check that `OP_REF` and `OP_SERVICE_ACCOUNT_TOKEN` are set correctly in `.env.local` and that the reference uses only one pair of quotes.
