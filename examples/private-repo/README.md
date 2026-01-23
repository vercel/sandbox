# Private Repository Example

This example demonstrates how to create an isolated environment from a private Git repository by authenticating with a GitHub personal access token or GitHub App token, and run a simple command inside the sandbox.

## Features

- Clone and access private GitHub repositories
- Authenticate using GitHub personal access tokens or GitHub App tokens
- Execute commands in a sandboxed environment
- Configure timeout and port settings

## How to Run

1. Navigate to the example directory:

   ```bash
   cd examples/private-repo
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Set up authentication:

   ```bash
   vercel link
   vercel env pull
   ```

   > **Alternative:** You can also use personal access tokens. Learn more: https://vercel.com/docs/vercel-sandbox#using-access-tokens

4. Set up your GitHub access token in `.env.local`:

   ```bash
   GIT_ACCESS_TOKEN=ghp_your_token_here
   ```

5. Run the example:
   ```bash
   pnpm start
   ```

## What This Example Shows

The `Sandbox.create()` method initializes the environment with the provided repository and configuration options, including:

- **Authentication credentials**: Using GitHub tokens for private repo access
- **Timeout configuration**: Setting maximum execution time
- **Port exposure**: Configuring which ports to expose from the sandbox

Once created, you can execute commands inside the sandboxed environment using `runCommand`.

## GitHub Access Token Options

There are several ways to authenticate with private GitHub repositories:

### Fine-grained Personal Access Token

Fine-grained tokens provide repository-specific access and enhanced security:

1. Go to **GitHub Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens**

2. Click **Generate new token**

3. Configure the token:

   - **Token name**: Give it a descriptive name (e.g., "Vercel Sandbox Access")
   - **Expiration**: Set an appropriate expiration date
   - **Resource owner**: Select your account or organization
   - **Repository access**: Choose "Selected repositories" and select your private repo
   - **Repository permissions**: Grant at minimum:
     - **Contents**: Read (to clone the repository)
     - **Metadata**: Read (for basic repository information)

4. Click **Generate token** and copy the token

5. Set it as an environment variable and run your sandbox script:
   ```bash
   export GIT_ACCESS_TOKEN=ghp_your_token_here
   pnpm dev
   ```

### Other GitHub Methods

- Create a classic personal access token
- Create a GitHub App installation token

## Configuration Options

The example shows how to configure:

- **Repository URL**: The private Git repository to clone
- **Authentication**: Username and password/token for private access
- **Timeout**: Maximum time for sandbox operations
- **Ports**: Which ports to expose from the sandbox environment
