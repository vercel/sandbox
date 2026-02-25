# 1Password Secrets Example

This example demonstrates how to inject 1Password secrets into a sandbox using secret references. It creates a sandbox with a secret resolved from 1Password, runs a command that uses it, and confirms the value is available in the environment.

## Features

- **Secret References**: Pass 1Password secret references (`op://vault/item/field`) in `integrations.onePassword.secrets` when creating a sandbox
- **Environment Injection**: Resolved secrets are merged into the environment for every command run in the sandbox
- **Optional Env Var**: Read the reference from `OP_REF` in `.env.local` so you don't hardcode it in code
- **Authentication**: Uses `OP_SERVICE_ACCOUNT_TOKEN` for 1Password

## Prerequisites

1. **Store a secret in 1Password**: In 1Password, create or use a vault item with a field that holds the secret you want in the sandbox. Note the secret reference (e.g. `op://Your Vault/Your Item/field name`). You’ll use this as `OP_REF` in step 4 below.

2. **Create a service account**: Use a [1Password service account](https://developer.1password.com/docs/service-accounts/) so the sandbox can read that secret. Create one in 1Password, grant it access to the vault that contains the item, and use its token for authentication.
   1. Create a service account in 1Password.
   2. Grant it access to the vault that contains your secret item.
   3. Copy its token; you’ll add it as `OP_SERVICE_ACCOUNT_TOKEN` in the “How to Run” section below.

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

4. Add these to `.env.local` (from [Prerequisites](#prerequisites): token from step 2, reference from step 1):

   **Service account token** (so the sandbox can read 1Password):
   ```bash
      OP_SERVICE_ACCOUNT_TOKEN="your-token"
   ```
   **Secret reference** (the op:// path to your vault item field):
   ```bash
      OP_REF="op://Your Vault/Your Item/field name"
   ```

6. Run the example

```bash
   pnpm start
```

You should see output like:

- `Creating sandbox with 1Password secrets...`
- `Sandbox created. Running command that uses the secret...`
- `MY_SECRET is set: yes` and a non-zero length (e.g. `Length: 8`)
- `Done.`

If you see `MY_SECRET is set:` with nothing after it and `Length: 0`, check that `OP_REF` and `OP_SERVICE_ACCOUNT_TOKEN` are set correctly in `.env.local` and that the reference uses only one pair of quotes.
