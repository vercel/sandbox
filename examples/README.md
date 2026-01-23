# Vercel Sandbox SDK Examples

This directory contains examples demonstrating different use cases and features of the Vercel Sandbox SDK. Each example includes a complete implementation with documentation on how to run it.

## Available Examples

### 🤖 [AI Example](./ai-example)

An interactive chat application that demonstrates how to use the Vercel Sandbox SDK with AI models. Features include:

- Code execution in sandboxed environments
- Real-time log streaming
- Interactive chat interface
- Syntax highlighting

### 🔐 [Private Repository Example](./private-repo)

Shows how to create sandboxed environments from private Git repositories using GitHub authentication. Features include:

- GitHub personal access token authentication
- Private repository cloning
- Secure environment creation
- Command execution in private repos

### 📦 [Install System Packages Example](./install-packages)

Demonstrates how to install system packages using the `dnf` package manager with elevated privileges. Features include:

- System package installation
- Elevated privilege execution
- Amazon Linux package management
- Development environment setup

### 📊 [Python Charts Example](./charts-python)

Shows how to use Vercel's AI Gateway with OpenAI GPT-4 to generate and execute Python chart code in a secure sandbox. Features include:

- AI-powered code generation with GPT-4
- Secure execution of AI-generated code
- Python data visualization with matplotlib
- Weather chart generation and file output

### 🔧 [Sandbox Basics Example](./sandbox-basics)

Demonstrates fundamental sandbox environment features and capabilities. Perfect for understanding the sandbox environment before building complex applications. Features include:

- Environment exploration (directory, PATH, available tools)
- System information and user context
- Environment variable management
- File operations and script execution
- Process management and signal handling
- Resource monitoring

### 🚀 [Development Server Example](./dev-server)

Shows how to create a sandbox from a Git repository and start a development server. Demonstrates a complete development workflow with live URLs. Features include:

- Git repository integration and cloning
- Dependency installation and management
- Development server startup with live log streaming
- Access your application through a public URL

### 📦 [Filesystem Snapshots Example](./filesystem-snapshots)

Demonstrates how to create and manage filesystem snapshots within a sandbox environment. Features include:

- Creating a new filesystem snapshot
- Listing existing snapshots
- Creating a new sandbox from a snapshot

## Getting Started

Each example is self-contained and can be run independently. To get started:

1. **Navigate to an example directory**:

   ```bash
   cd examples/[example-name]
   ```

2. **Install dependencies**:

   ```bash
   pnpm install
   ```

3. **Set up authentication** (required for all examples):

   Link to a Vercel project and pull environment variables:

   ```bash
   vercel link
   vercel env pull
   ```

   This creates a `.env.local` file with your OIDC token.

   > **Alternative:** You can also use personal access tokens. Learn more at: https://vercel.com/docs/vercel-sandbox#using-access-tokens

4. **Follow the specific example's README** for any additional setup requirements

## Common Requirements

All examples require:

- Node.js 18+
- pnpm (recommended) or npm
- The Vercel Sandbox SDK (automatically installed as workspace dependency)

## Running Examples

Most examples can be run with:

```bash
pnpm start
```

Some examples may require additional setup like environment variables (e.g., GitHub tokens for private repositories). AI examples use Vercel's AI Gateway and don't require separate API keys. Check each example's README for specific requirements.

## Contributing

When adding new examples:

1. Follow the established directory structure
2. Include comprehensive README documentation
3. Add proper TypeScript configuration
4. Ensure examples are self-contained and runnable
5. Update this main README with the new example

## Learn More

- [Vercel Sandbox SDK Documentation](https://vercel.com/docs/vercel-sandbox)
- [SDK Reference](https://vercel.com/docs/vercel-sandbox/sdk-reference)
