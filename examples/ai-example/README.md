# AI Example

This example demonstrates how to use the Vercel Sandbox SDK with AI models to create interactive chat applications. It shows how to execute code in a sandboxed environment and display the results in a Next.js application.

## Features

- Interactive chat interface with AI models
- Code execution in sandboxed environments
- Real-time log streaming
- Syntax highlighting for code blocks
- Responsive UI with resizable panels

## How to Run

1. Navigate to the example directory:

   ```bash
   cd examples/ai-example
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

   > **Note:** No AI provider API keys are needed! This example uses Vercel's AI Gateway which provides access to AI models without requiring your own API keys.

4. Run the development server:

   ```bash
   pnpm start
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## What This Example Shows

- **Sandbox Integration**: How to create and manage sandboxed environments
- **AI Chat Interface**: Building a chat UI that can execute code
- **Real-time Updates**: Streaming logs and responses from the sandbox
- **Code Execution**: Running commands and displaying results safely
