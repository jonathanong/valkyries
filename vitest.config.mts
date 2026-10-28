import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // package.json maps #lua-sources into dist; tests run the sources without a build.
  resolve: {
    alias: { "#lua-sources": fileURLToPath(new URL("./lua-sources.node.mts", import.meta.url)) },
  },
  test: {
    environment: "node",
    globals: false,
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov", "json-summary"],
      include: [
        "index.mts",
        "cache.mts",
        "bloom-filter.mts",
        "dynamic-config.mts",
        "rate-limiter.mts",
        "events.mts",
        "errors.mts",
        "key-normalization.mts",
        "cache-utils.mts",
        "cache-metrics.mts",
        "scripts.mts",
        "lua-sources.node.mts",
        "retry.mts",
        "utils.mts",
        "clients.mts",
        "expiry.mts",
        "scan.mts",
        "diagnostics.mts",
        "channel-pubsub.mts",
        "channel-pubsub-internals.mts",
        "conditional.mts",
        "lease.mts",
        "lease/**/*.mts",
      ],
      exclude: [
        "**/__tests__/**",
        "cache/**",
        "bloom-filter/**",
        "dynamic-config/**",
        "vitest.config.mts",
        "build-scripts/copy-lua-scripts.mts",
        "node_modules/**",
        "dist/**",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
