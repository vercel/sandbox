import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { FORCE_COLOR: "1" },
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 60_000,
  },
});
