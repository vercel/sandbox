# Development Server Example

This example demonstrates how to create a sandbox from a Git repository and start a development server. It clones a Next.js project, installs dependencies, starts the dev server, and provides a live URL to access the application.

## Features

- **Git Repository Integration**: Clone and run code from any public Git repository
- **Dependency Installation**: Automatically install npm packages
- **Development Server**: Start development servers with live log streaming
- **Live URLs**: Access your application through a public URL

## How to Run

1. Navigate to the example directory:

   ```bash
   cd examples/dev-server
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

   > **Alternative:** You can also use personal access tokens. Learn more: https://vercel.com/docs/vercel-sandbox/concepts/authentication#access-tokens

4. Run the example:
   ```bash
   pnpm start
   ```

## What This Example Shows

This example demonstrates a complete development workflow:

- **Repository Cloning**: Creates a sandbox from a Git repository (Next.js example)
- **Port Exposure**: Exposes port 3000 for the development server
- **Dependency Management**: Runs `npm install` to install project dependencies
- **Server Management**: Starts the development server with live log streaming
- **URL Access**: Provides a live URL to access the running application

The example clones a Next.js repository, installs dependencies, starts the development server, and automatically opens the browser to the live URL. Development server logs are streamed directly to your terminal for real-time feedback.
