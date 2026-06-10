import { defineConfig } from "tsdown";

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
});
