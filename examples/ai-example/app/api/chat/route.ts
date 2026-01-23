import { gateway } from "@/lib/gateway";
import { convertToModelMessages, streamText } from "ai";

const SYSTEM_PROMPT = `
You are an AI asistant that buils web applications based on the user input. 
You must include configuration files, package.json, etc.
Everything needed to run the application should be included.
Show the files using custom code blocks with the following format:
  \`\`\`<type here> file="path/to/file.js"
  <Your code here>
  \`\`\`

Include the type only there is an extension, otherwise leave it empty.
Do not include git files.

If you are asked for a modification of the generated code, you must return
only the files that have been modified or those that are new.
`;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: gateway("anthropic/claude-4-sonnet-20250514"),
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    onError: (error) => {
      console.error("Error communicating with AI", error);
    },
  });

  return result.toUIMessageStreamResponse();
}
