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
    // PGlite boots a whole Postgres in WASM per file; under a loaded full run
    // that alone can pass the 5s default. The db tests get room, the pure
    // tests keep the tight default so a real hang still shows.
    projects: [
      { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"], exclude: ["src/**/*.db.test.ts"] } },
      { extends: true, test: { name: "db", include: ["src/**/*.db.test.ts"], testTimeout: 60_000, hookTimeout: 60_000 } },
    ],
  },
});
