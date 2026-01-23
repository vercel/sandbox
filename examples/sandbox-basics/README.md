# Sandbox Basics Example

This example demonstrates fundamental sandbox environment features and capabilities. It provides a comprehensive overview of what's available in a sandbox environment and how to interact with it programmatically.

## Features

- **Environment Exploration**: Check current directory, PATH, and available tools
- **System Information**: Get details about the operating system and user context
- **Environment Variables**: Set and use custom environment variables
- **File Operations**: Create, write, and manage files and directories
- **Script Execution**: Create and run bash scripts with arguments
- **Process Management**: Start processes and send signals (SIGTERM, SIGINT)
- **Resource Monitoring**: Check disk and memory usage

## How to Run

1. Navigate to the example directory:

   ```bash
   cd examples/sandbox-basics
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

This example demonstrates the powerful capabilities of the sandbox environment:

- **Environment Discovery**: Shows the current working directory (`/vercel/sandbox`), PATH environment, and available tools
- **System Information**: Displays OS details, user context, and system resources
- **Environment Variables**: How to set and use custom environment variables with `export`
- **File and Script Operations**: Creating files with `writeFiles()`, executable bash scripts, and directory management
- **Process Management**: Starting background processes, sending signals (SIGTERM/SIGINT), and proper cleanup
- **Resource Monitoring**: Checking disk usage, memory consumption, and system limits

The example creates scripts, manages processes, handles signals, and demonstrates the full lifecycle of sandbox operations. It serves as a comprehensive introduction to sandbox capabilities and is perfect for understanding the environment before building more complex applications.
