import { describe, expect, test } from "vitest";
import { Sandbox, command } from "../src";

describe("README examples", () => {
  test("basic usage", async () => {
    const sandbox = await Sandbox.create();
    const result = await sandbox.runCommand("echo", ["hello"]);
    expect(await result.stdout()).toContain("hello\n");
    await sandbox.stop();
  });

  test("static command handler", async () => {
    const sandbox = await Sandbox.create({
      handlers: [command("npm install", { stdout: "added 1 package\n", exitCode: 0 })],
    });

    const result = await sandbox.runCommand("npm", ["install", "react"]);
    expect(await result.stdout()).toBe("added 1 package\n");
    await sandbox.stop();
  });

  test("dynamic command handler", async () => {
    const sandbox = await Sandbox.create({
      handlers: [
        command(/^greet/, (args) => ({
          stdout: `Hello ${args[0] ?? "world"}\n`,
          exitCode: 0,
        })),
      ],
    });

    const result = await sandbox.runCommand("greet", ["Alice"]);
    expect(await result.stdout()).toBe("Hello Alice\n");
    await sandbox.stop();
  });

  test("file operations", async () => {
    const sandbox = await Sandbox.create();

    await sandbox.writeFiles([
      { path: "/app/index.ts", content: Buffer.from('console.log("hi")') },
    ]);

    const stream = await sandbox.readFile({ path: "/app/index.ts" });
    expect(stream).not.toBeNull();

    const chunks: Buffer[] = [];
    for await (const chunk of stream!) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    expect(Buffer.concat(chunks).toString("utf-8")).toBe('console.log("hi")');
    await sandbox.stop();
  });

  test("cleanup via AsyncDisposable", async () => {
    await using sandbox = await Sandbox.create();
    expect(sandbox.status).toBe("running");
  });
});
