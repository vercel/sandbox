import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/auth/index.ts", "src/mock/index.ts"],
  outDir: "dist",
  format: ["esm", "cjs"],
  outExtensions: ({ format }) => ({
    js: format === "cjs" ? ".cjs" : ".js",
  }),
  sourcemap: true,
  dts: true,
  target: "es2020",
  // Do not bundle internal modules into a single file. This keeps Node.js
  // imports local to the files that use them, so the Workflow DevKit SWC
  // compiler can strip "use step" method bodies and their associated imports
  // independently — preventing false build errors in the workflow VM context.
  bundle: false,
});
