import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VAULTS_META, FALLBACK_VAULT_META } from "./vaults-meta";

/**
 * Before 2026-09-14 this repo was LSTeaTime, a leveraged staking app. Berth
 * sells stocks and funds; its copy must not talk about liquid staking,
 * JitoSOL or staking vaults. The one exception is the withdraw-only path
 * for positions opened before Berth (keys starting with `vault`, and the
 * legal text that names the fee on such a withdrawal).
 */
/**
 * Argument sets each copy function is called with, in turn, until one
 * works: plain words, lists of names, and the one object-shaped argument
 * (portfolioRangeTrades). A function none of them can call fails the test
 * below by path, rather than hiding its words from the walk.
 */
const NAMES = ["NVIDIA", "Apple"];
const PROBES: unknown[][] = [
  ["NVIDIA", "Apple", "x", "buy"],
  [NAMES, NAMES, NAMES, NAMES],
  [{ bought: NAMES, moreBought: 1, sold: NAMES, moreSold: 1 }],
];
const uncallable: string[] = [];

function strings(value: unknown, path: string, out: Array<[string, string]>, depth = 0): void {
  if (depth > 12 || value === null || value === undefined) return;
  if (typeof value === "string") out.push([path, value]);
  else if (typeof value === "function") {
    for (const args of PROBES) {
      try {
        strings((value as (...args: unknown[]) => unknown)(...args), `${path}()`, out, depth + 1);
        return;
      } catch {
        // Try the next shape of argument.
      }
    }
    uncallable.push(path);
  } else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out, depth + 1));
  else if (typeof value === "object") for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out, depth + 1);
}

const user: Array<[string, string]> = [];
for (const [key, value] of Object.entries(COPY)) if (key !== "staff") strings(value, key, user);

const LEFTOVER = /jito|liquid[ -]?stak|\bLSTs?\b|\bLSDs?\b|lsteatime|staking|staked|\bAPY\b|leverag/i;
const LEGACY_VAULT_PATH = /(^|\.)(vault\w*|ctaVault\w*)(\(\))?$/;

describe("no LSTeaTime leftovers in user facing copy", () => {
  it("walks a real amount of copy, the terms and privacy policy included, and calls every copy function", () => {
    expect(user.length).toBeGreaterThan(500);
    expect(user.some(([path]) => path.startsWith("termsOfUse."))).toBe(true);
    expect(user.some(([path]) => path.startsWith("privacyPolicy."))).toBe(true);
    expect(uncallable).toEqual([]);
  });

  it("keeps the rendered emails free of it too", () => {
    const rendered = readFileSync(join(__dirname, "server/email/__snapshots__/templates.test.ts.snap"), "utf8");
    expect(rendered.length).toBeGreaterThan(1000);
    expect(rendered.match(LEFTOVER)).toBeNull();
  });

  it("mentions staking, JitoSOL or leverage only on the withdraw-only vault path", () => {
    const hits = user.filter(([path, text]) => LEFTOVER.test(text) && !LEGACY_VAULT_PATH.test(path));
    expect(hits.map(([path]) => path)).toEqual([]);
  });

  it("names the Solana assets Berth takes, without JitoSOL", () => {
    expect(COPY.receiveSolanaBody).toBe("Only for SOL or USDC on Solana.");
  });

  it("keeps vault names to titles, with no strategy pitch", () => {
    for (const meta of [...Object.values(VAULTS_META), FALLBACK_VAULT_META]) {
      expect(Object.keys(meta)).toEqual(["title"]);
    }
  });
});
