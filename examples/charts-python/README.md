# AI Gateway Charts Example

This example demonstrates how to use Vercel's AI Gateway with OpenAI GPT-4 to generate Python chart code and execute it in a secure, isolated sandbox environment. The AI generates code to create weather visualization charts, and the Sandbox SDK runs the code safely to produce the final image.

## Features

- **AI Code Generation**: Uses OpenAI GPT-4 to generate Python visualization code
- **Secure Execution**: Runs AI-generated code in isolated sandbox environment
- **Chart Creation**: Generates weather data visualizations using matplotlib
- **File Retrieval**: Downloads generated charts from sandbox to local system
- **Python Runtime**: Uses built-in Python 3.13 runtime with package installation via uv

## How to Run

1. Navigate to the example directory:

   ```bash
   cd examples/ai-gateway-charts
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

   > **Note:** No AI provider API keys are needed! This example uses Vercel's AI Gateway which provides access to OpenAI GPT-4 without requiring your own API keys.

4. Run the example:
   ```bash
   pnpm start
   ```

## What This Example Shows

This example demonstrates the powerful combination of AI and secure code execution:

- **AI-Powered Code Generation**: GPT-4 generates Python code for data visualization
- **Sandbox Security**: AI-generated code runs in an isolated environment
- **Python Runtime**: Uses the built-in Python 3.13 runtime with uv for package installation
- **Data Visualization**: Creates professional charts using matplotlib
- **File Management**: Retrieves generated files from sandbox to local system

## Example Output

The example generates a chart showing average temperatures across the year in Berlin, with:

- Monthly temperature data (realistic seasonal variations)
- Professional styling with colors and grid
- Proper labels and title
- Created in the sandbox and saved locally as `berlin_weather.png`

This demonstrates how AI can generate functional, production-ready visualization code that runs safely in an isolated environment, with the ability to retrieve the generated files back to your local system.
