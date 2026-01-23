import { defineConfig } from "tsdown";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default defineConfig({
  entry: ["src/index.ts", "src/sandbox.ts"],
  outDir: "dist",
  format: ["esm"],
  sourcemap: true,
  define: {
    "process.env.VERCEL_DEV": JSON.stringify("0"),
  },
  dts: true,
  target: "es2020",
  async onSuccess() {
    const x86 = require.resolve(
      "@vercel/pty-tunnel-server/public/linux-x86_64",
    );
    await fs.copyFile(x86, "dist/pty-server-linux-x86_64");
  },
});
