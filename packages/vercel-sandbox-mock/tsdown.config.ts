import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/proxy.ts"],
  outDir: "dist",
  format: ["esm", "cjs"],
  outExtensions: ({ format }) => ({
    js: format === "cjs" ? ".cjs" : ".js",
  }),
  sourcemap: true,
  dts: true,
  target: "es2020",
  // Bundle internal modules together. Unlike @vercel/sandbox (which keeps
  // imports local for the Workflow SWC compiler), this package uses
  // extensionless relative imports and has no "use step" constraint, so a
  // single bundle per entry is the simplest way to produce valid ESM/CJS.
  bundle: true,
});
