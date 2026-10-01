import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // One toast stack: every toast goes through lib/toast's queue, so two
  // things said at once stack or merge instead of drawing over each other.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/toast-stack.tsx", "src/components/ui/sonner.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "sonner", message: 'Import { toast } from "@/lib/toast"; the stack renders through components/toast-stack.' }] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
