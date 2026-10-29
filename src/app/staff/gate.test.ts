import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every door of the staff area goes through the gate. Read over the files
 * themselves, so a new one cannot forget it:
 *
 * - under src/app/staff only page.tsx and the bare layout.tsx may exist
 *   (no route, loading, metadata image or other file that could render or
 *   read before the gate), the layout reads nothing, and every page awaits
 *   staffGate("page") before anything else;
 * - under src/app/api/staff every exported method of every route is
 *   staffRoute(...) or one of STAFF_OTHER_METHODS, whatever way it is
 *   exported. The one exception is the session door's POST, which the
 *   proxy guards with a Privy token check and which checks again itself.
 * - the proxy covers both trees.
 *
 * The campaigns and emails routes gate on lib/server/staff-auth requireStaff
 * (and requireFreshStaff for what sends), which read the same staff session;
 * they are listed by path below.
 */

const ROOT = process.cwd();
const ALLOWED_UNWRAPPED = new Set(["src/app/api/staff/session/route.ts POST", "src/app/api/staff/campaigns/route.ts POST", "src/app/api/staff/emails/route.ts POST"]);
const ALLOWED_PAGES_WITHOUT_GATE = new Set<string>([]);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else out.push(path);
  }
  return out;
}

const rel = (path: string) => relative(ROOT, path);

/** Every exported name of a module and how it is defined: "wrapped", "other", or "bare". */
export function exportedMethods(source: string): Map<string, "wrapped" | "other" | "bare"> {
  const out = new Map<string, "wrapped" | "other" | "bare">();
  for (const match of source.matchAll(/export\s+const\s+([A-Z]+)\s*=\s*(staffRoute\(|missing\b)?/g)) {
    out.set(match[1], match[2] === undefined ? "bare" : match[2].startsWith("staffRoute") ? "wrapped" : "other");
  }
  for (const match of source.matchAll(/export\s+const\s*\{([^}]*)\}\s*=\s*(\w+)/g)) {
    for (const name of match[1].split(",").map((part) => part.trim().split(/\s*:\s*/).pop()!).filter(Boolean)) {
      out.set(name, match[2] === "STAFF_OTHER_METHODS" ? "other" : "bare");
    }
  }
  for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Z]+)\b/g)) out.set(match[1], "bare");
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()!.trim();
      if (/^[A-Z]+$/.test(name)) out.set(name, "bare");
    }
  }
  return out;
}

describe("the staff gate covers every door", () => {
  it("only pages and a bare layout live under src/app/staff", () => {
    for (const path of files(join(ROOT, "src/app/staff"))) {
      const name = rel(path);
      if (name.endsWith(".test.ts")) continue;
      expect(/\/(page|layout)\.tsx$/.test(name), `${name} is not a page or the layout`).toBe(true);
    }
    const layout = readFileSync(join(ROOT, "src/app/staff/layout.tsx"), "utf8");
    expect(layout).not.toMatch(/\bawait\b|generateMetadata|getSql/);
  });

  it("every page awaits staffGate first", () => {
    const pages = files(join(ROOT, "src/app/staff")).filter((path) => path.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThanOrEqual(7);
    for (const page of pages) {
      const name = rel(page);
      const source = readFileSync(page, "utf8");
      expect(source, name).not.toMatch(/generateMetadata|generateStaticParams/);
      if (ALLOWED_PAGES_WITHOUT_GATE.has(name)) continue;
      const at = source.indexOf("export default async function");
      expect(at, `${name} has no async default export`).toBeGreaterThan(-1);
      const body = source.slice(at);
      const gate = body.indexOf('await staffGate("page"');
      expect(gate, name).toBeGreaterThan(-1);
      const firstAwait = body.search(/\bawait\b/);
      expect(firstAwait, `${name} awaits something before the gate`).toBe(gate);
    }
  });

  it("every method of every staff route is wrapped or refused", () => {
    const routes = files(join(ROOT, "src/app/api/staff")).filter((path) => path.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThanOrEqual(5);
    for (const route of routes) {
      const name = rel(route);
      const methods = exportedMethods(readFileSync(route, "utf8"));
      for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        const kind = methods.get(method);
        if (kind === "bare") expect(ALLOWED_UNWRAPPED.has(`${name} ${method}`), `${name} ${method} is not wrapped`).toBe(true);
        if (kind === undefined && !name.includes("/campaigns/")) {
          // Unexported, Next would answer 405 (and OPTIONS 204): it must be refused explicitly.
          expect.fail(`${name} does not refuse ${method}`);
        }
      }
    }
  });

  it("the proxy and next.config's refusal cover both trees, the same list", async () => {
    const { config } = await import("@/proxy");
    const { STAFF_SOURCES, NOWHERE_PATH } = await import("@/lib/nowhere");
    expect(config.matcher).toEqual([...STAFF_SOURCES]);
    const next = (await import("../../../next.config")).default((await import("next/constants")).PHASE_PRODUCTION_BUILD);
    const rewrites = (await next.rewrites!()) as { beforeFiles: { source: string; missing: unknown[]; destination: string }[]; fallback: { destination: string }[] };
    // One rule per source for a request the proxy refused (marked), one for a request with no credential at all.
    expect(rewrites.beforeFiles.map((rule) => rule.source)).toEqual([...STAFF_SOURCES, ...STAFF_SOURCES]);
    const marked = rewrites.beforeFiles.slice(0, STAFF_SOURCES.length) as unknown as { has: unknown[]; destination: string }[];
    for (const rule of marked) {
      expect(rule.destination).toBe(NOWHERE_PATH);
      expect(rule.has).toEqual([{ type: "header", key: "x-berth-refused" }]);
    }
    for (const rule of rewrites.beforeFiles.slice(STAFF_SOURCES.length)) {
      expect(rule.destination).toBe(NOWHERE_PATH);
      expect(rule.missing).toEqual([
        { type: "cookie", key: "berth-staff" },
        { type: "header", key: "authorization" },
      ]);
    }
    expect((rewrites.fallback[0] as unknown as { source: string }).source).toBe("/:path((?!_next/|_vercel/).*)");
    expect(rewrites.fallback[0].destination).toBe(NOWHERE_PATH);
    // Importing the proxy loads the server modules behind it: room for a loaded run.
  }, 30_000);

  it("reads exports however they are written", () => {
    const methods = exportedMethods(`export const POST = staffRoute(x);\nexport const { GET, HEAD: H2 } = STAFF_OTHER_METHODS;\nexport async function PUT() {}\nconst h = 1; export { h as DELETE };`);
    expect(Object.fromEntries(methods)).toEqual({ POST: "wrapped", GET: "other", H2: "other", PUT: "bare", DELETE: "bare" });
  });
});
