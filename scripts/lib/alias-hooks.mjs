/**
 * Lets a node script import the app's own TypeScript modules as they are:
 * `@/lib/x` resolves to `src/lib/x.ts`, and an extensionless relative import
 * from a .ts file gets its `.ts`. Used with Node's type stripping:
 *
 *   node --no-warnings --experimental-strip-types --import ./scripts/lib/alias.mjs scripts/x.mjs
 *
 * Only resolution changes here; nothing is compiled beyond what Node strips.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = new URL("../../src/", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", "/index.ts"];

function candidate(url) {
  const path = fileURLToPath(url);
  if (existsSync(path) && !path.endsWith("/")) {
    // A directory or a file with an extension already.
    if (/\.[cm]?[jt]sx?$|\.json$/.test(path)) return url;
  }
  for (const extension of EXTENSIONS) {
    if (existsSync(path + extension)) return pathToFileURL(path + extension).href;
  }
  return undefined;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const found = candidate(new URL(specifier.slice(2), SRC).href);
    if (found) return nextResolve(found, context);
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.endsWith(".ts")
  ) {
    const found = candidate(new URL(specifier, context.parentURL).href);
    if (found) return nextResolve(found, context);
  }
  // next's subpath entry points (next/cache, next/server) are .js files
  // with no exports map, which Node's ESM resolver will not guess.
  if (/^next\/[a-z-]+$/.test(specifier)) {
    try {
      return await nextResolve(specifier, context);
    } catch {
      return nextResolve(`${specifier}.js`, context);
    }
  }
  return nextResolve(specifier, context);
}
