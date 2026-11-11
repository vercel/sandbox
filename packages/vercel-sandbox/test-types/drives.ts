import type { Drive } from "@vercel/drives";
import type { Sandbox, SandboxMounts } from "../src/index.js";

declare const drive: Drive;

const mounts = {
  "/data": drive,
  "/snapshot": drive.snapshot(),
} satisfies SandboxMounts;

void ({ mounts } satisfies Parameters<typeof Sandbox.create>[0]);
void ({ sourceSandbox: "source", mounts } satisfies Parameters<
  typeof Sandbox.fork
>[0]);
