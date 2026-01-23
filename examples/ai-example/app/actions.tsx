"use server";

import { Sandbox } from "@vercel/sandbox";
import { formSchema, type FormData } from "./schema";
import { getAIResponse } from "@/lib/get-ai-response";

export async function createSandbox() {
  const sandbox = await Sandbox.create({
    ports: [3000],
  });

  return {
    id: sandbox.sandboxId,
    routes: sandbox.routes,
    url: sandbox.domain(3000),
  };
}

export async function uploadFiles(params: {
  sandboxId: string;
  files: { path: string; content: string }[];
}) {
  const sandbox = await Sandbox.get({
    sandboxId: params.sandboxId,
  });

  const files = params.files.map((file) => ({
    path: file.path,
    content: Buffer.from(file.content, "utf-8"),
  }));

  const createdPaths = new Set<string>();

  for (const file of files) {
    const pathParts = file.path.split("/");
    let pathAccumulator = "";
    for (let i = 0; i < pathParts.length - 1; i++) {
      pathAccumulator += pathParts[i];
      if (!createdPaths.has(pathAccumulator)) {
        await sandbox.mkDir(pathAccumulator).catch((_) => {
          // nothing
        });
        createdPaths.add(pathAccumulator);
      }
      pathAccumulator += "/";
    }
  }

  console.log(
    "Uploading files",
    files.map((file) => file.path),
  );
  await sandbox.writeFiles(files);
}

export async function runCommand(params: {
  args: string[];
  cmd: string;
  sandboxId: string;
  detached?: boolean;
}) {
  const sandbox = await Sandbox.get({
    sandboxId: params.sandboxId,
  });

  const cmd = await sandbox.runCommand({
    args: params.args,
    cmd: params.cmd,
    detached: params.detached,
  });

  return {
    cmdId: cmd.cmdId,
  };
}

export async function runPrompt(data: FormData) {
  const parsedData = formSchema.safeParse(data);
  if (!parsedData.success) {
    return { success: false, errors: parsedData.error.flatten().fieldErrors };
  }

  const [response, sandbox] = await Promise.all([
    getAIResponse(parsedData.data.prompt),
    Sandbox.create({ ports: [3000] }),
  ]);

  const files = response.files.map((file) => ({
    path: file.path,
    content: Buffer.from(file.content, "utf-8"),
  }));

  const createdPaths = new Set<string>();

  for (const file of files) {
    const pathParts = file.path.split("/");
    let pathAccumulator = "";
    for (let i = 0; i < pathParts.length - 1; i++) {
      pathAccumulator += pathParts[i];
      if (!createdPaths.has(pathAccumulator)) {
        console.log("Creating path", pathAccumulator);
        await sandbox.mkDir(pathAccumulator);
        createdPaths.add(pathAccumulator);
      }
      pathAccumulator += "/";
    }
  }

  console.log(
    "Uploading files",
    files.map((file) => file.path),
  );
  await sandbox.writeFiles(files);

  console.log("Installing dependencies");
  await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "--loglevel", "info"],
  });

  console.log(`Starting the development server...`);
  await sandbox.runCommand({
    cmd: "npm",
    args: ["run", "dev"],
    detached: true,
  });

  console.log("Sandbox created successfully", sandbox.domain(3000));
}
