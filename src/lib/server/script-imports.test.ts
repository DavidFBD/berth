import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The node scripts (pnpm orders:recover and the backfills) load the app's
 * TypeScript through Node's type stripping, which cannot load a .tsx. This
 * walks every static import a script reaches inside src and fails on any
 * .tsx, so a server module that grows a JSX dependency (the email sender
 * did, and orders:recover stopped loading) is caught here, not at 2 a.m.
 * Dynamic `import()` is the way to reach JSX lazily, and is not followed.
 */
const ROOT = resolve(__dirname, "../../..");
const SRC = join(ROOT, "src");
// email-test sends real mail through the sender itself; it is not a script
// that may stay clear of it.
const EXEMPT = new Set(["email-test.mjs"]);

const STATIC = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;
const SCRIPT_IMPORT = /["'](\.\.\/src\/[^"']+)["']/g;

function resolveFile(base: string): string | undefined {
  if (/\.(ts|tsx|mjs|js)$/.test(base) && existsSync(base)) return base;
  for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(base + ext)) return base + ext;
  return undefined;
}

function resolveSpecifier(specifier: string, from: string): string | undefined {
  if (specifier.startsWith("@/")) return resolveFile(join(SRC, specifier.slice(2)));
  if (specifier.startsWith("./") || specifier.startsWith("../")) return resolveFile(resolve(dirname(from), specifier));
  return undefined; // a package
}

function tsxReached(entries: string[]): { tsx: string; chain: string[] }[] {
  const seen = new Map<string, string | null>();
  const queue = entries.map((entry) => {
    seen.set(entry, null);
    return entry;
  });
  const found: { tsx: string; chain: string[] }[] = [];
  while (queue.length) {
    const file = queue.shift()!;
    if (file.endsWith(".tsx")) {
      const chain = [file];
      for (let at = seen.get(file); at; at = seen.get(at)) chain.unshift(at);
      found.push({ tsx: file, chain: chain.map((path) => path.slice(ROOT.length + 1)) });
      continue;
    }
    for (const match of readFileSync(file, "utf8").matchAll(STATIC)) {
      const next = resolveSpecifier(match[1], file);
      if (next && !seen.has(next)) {
        seen.set(next, file);
        queue.push(next);
      }
    }
  }
  return found;
}

describe("node scripts", () => {
  const scripts = readdirSync(join(ROOT, "scripts")).filter((name) => name.endsWith(".mjs") && !EXEMPT.has(name));

  it.each(scripts)("%s reaches no .tsx through static imports", (name) => {
    const script = join(ROOT, "scripts", name);
    const entries = [...readFileSync(script, "utf8").matchAll(SCRIPT_IMPORT)]
      .map((match) => resolveFile(resolve(dirname(script), match[1])))
      .filter((path): path is string => Boolean(path));
    expect(tsxReached(entries)).toEqual([]);
  });

  it("finds a .tsx when one is reached", () => {
    expect(tsxReached([join(SRC, "lib/server/email/send.tsx")]).length).toBe(1);
  });
});
