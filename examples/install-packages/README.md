# Install System Packages Example

This example demonstrates how to install system packages using the `dnf` system package manager in a sandboxed environment. It shows how to use elevated privileges to install packages like Go, Python, or other system tools.

## Features

- Install system packages using the `dnf` package manager
- Execute commands with elevated privileges using `sudo: true`
- Work with Amazon Linux package repositories
- Configure package installation in sandboxed environments

## How to Run

1. Navigate to the example directory:

   ```bash
   cd examples/install-packages
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

4. Run the example:
   ```bash
   pnpm start
   ```

## What This Example Shows

This example demonstrates:

- **Package Installation**: Using `dnf` to install system packages
- **Elevated Privileges**: Using `sudo: true` to run commands with root access
- **Package Manager**: Working with Amazon Linux's package management system
- **System Configuration**: Setting up development tools in the sandbox

## Available Packages

You can find the list of available packages on the [Amazon Linux documentation](https://docs.aws.amazon.com/linux/al2023/ug/package-repository.html).

## Key Features

- **Elevated Privileges**: The `sudo: true` option allows commands to run with root access
- **Package Management**: Full access to the `dnf` package manager
- **System Configuration**: Ability to install and configure system-level tools
- **Development Environment**: Set up complete development environments

## Important Notes

- Always use the `-y` flag with `dnf install` to automatically confirm installations
- The `sudo: true` option is required for package installation operations
- Package availability depends on the Amazon Linux repositories
- Some packages may require additional configuration after installation
