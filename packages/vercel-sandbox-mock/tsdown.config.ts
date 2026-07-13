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
  bundle: false,
});
