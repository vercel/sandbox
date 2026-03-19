import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/auth/index.ts"],
  outDir: "dist",
  format: ["esm", "cjs"],
  outExtensions: ({ format }) => ({
    js: format === "cjs" ? ".cjs" : ".js",
  }),
  sourcemap: true,
  dts: true,
  target: "es2020",
});
