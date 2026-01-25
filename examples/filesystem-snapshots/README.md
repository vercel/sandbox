# Sandbox Filesystem Snapshots Example

Demonstrates how to create and manage filesystem snapshots within a sandbox environment.

## How to Run

1. Navigate to the example directory:

   ```bash
   cd examples/filesystem-snapshots
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

   > **Alternative:** You can also use personal access tokens. Learn more: https://vercel.com/docs/vercel-sandbox#using-access-tokens

4. Run the example:
   ```bash
   pnpm start
   ```

## What This Example Shows

- How to create new filesystem snapshots from a sandbox
- How to listing existing snapshots
- How to create a new sandbox from an existing snapshot
