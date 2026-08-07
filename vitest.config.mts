import { defineConfig } from "vitest/config";

// Tests cover the pure cores of deep modules (lib/ and the reducers behind
// hooks). Anything that needs a mounted provider tree, a live chain, Neon, or
// Privy stays out of scope by design: the interface is the test surface, and
// these modules were shaped so their interesting logic is reachable without
// infrastructure.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
