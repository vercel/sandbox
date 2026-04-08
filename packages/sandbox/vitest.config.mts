import { defineConfig } from "vitest/config";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    alias: {
      // cmd-ts ships both CJS and ESM but its "main" points to CJS, which
      // tries to require() chalk v5 (ESM-only). Force the ESM entry.
      "cmd-ts": path.join(
        path.dirname(require.resolve("cmd-ts/package.json")),
        "dist/esm/index.js",
      ),
    },
  },
});
