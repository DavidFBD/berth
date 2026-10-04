import { describe, expect, it } from "vitest";
import { COPY } from "./copy";

/**
 * Jev filters and judges the news silently. Users are never told its name
 * (docs/product/features.md, "Don't name Jev to users"). The one place its
 * maker may be named is the privacy policy's processor list, and even there
 * only as "TypeSafe", never "Jev". The staff area is not user facing.
 */
const PROBE = ["NVIDIA", "Apple", "x", "buy"];

function strings(value: unknown, path: string, out: Array<[string, string]>, depth = 0): void {
  if (depth > 12 || value === null || value === undefined) return;
  if (typeof value === "string") out.push([path, value]);
  else if (typeof value === "function") {
    try {
      const said = (value as (...args: unknown[]) => unknown)(...PROBE);
      strings(said, `${path}()`, out, depth + 1);
    } catch {
      /* needs richer arguments; its fixed words are exercised elsewhere */
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out, depth + 1));
  else if (typeof value === "object") for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out, depth + 1);
}

const user: Array<[string, string]> = [];
for (const [key, value] of Object.entries(COPY)) if (key !== "staff") strings(value, key, user);

describe("user facing copy", () => {
  it("walks a real amount of copy", () => {
    expect(user.length).toBeGreaterThan(500);
  });

  it("never names Jev", () => {
    expect(user.filter(([, text]) => /\bjev\b/i.test(text)).map(([path]) => path)).toEqual([]);
  });

  it("names TypeSafe only in the privacy policy's processor list, as a news-relevance model", () => {
    const hits = user.filter(([, text]) => /typesafe/i.test(text));
    expect(hits.length).toBeGreaterThan(0);
    for (const [path, text] of hits) {
      expect(path.startsWith("privacyPolicy.")).toBe(true);
      expect(text).toContain("news-relevance model");
    }
  });
});
