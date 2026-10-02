import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";

/**
 * The drawer's invite step shares the friend link (/f/<token>), which asks
 * to be friends and waits for a yes (lib/server/social/friends): only the
 * referral invite makes two people friends at once. The words must say
 * what the link does, the same as the Friends screen's own line.
 */
describe("drawer copy", () => {
  it("says the friend link asks, never that it makes friends at once", () => {
    expect(COPY.drawer.inviteSub).toContain(COPY.social.shareLinkSub);
    expect(COPY.drawer.inviteSub.toLowerCase()).not.toMatch(/at once|instantly|right away|are friends/);
  });

  it("uses no dashes as punctuation", () => {
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") strings.push(String((value as (...a: number[]) => string)(1, 2)));
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(COPY.drawer);
    for (const line of strings) expect(line).not.toMatch(/ [-–—] |—|–/);
  });
});
