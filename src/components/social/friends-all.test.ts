import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MySocial } from "@/lib/social-types";

// The home's step cards reach the wallet SDKs, which do not load under node; only their button class is borrowed.
vi.mock("@/components/home-next-step", () => ({ PRIMARY: "h-11 w-full rounded-full" }));
vi.mock("@/hooks/use-social", () => ({ useTurnOnAllFriends: () => ({ mutate: () => {}, isPending: false }) }));
const { FriendsAllOffer } = await import("./friends-all");

const NEW: MySocial = { hasEmail: true, handle: "gosia", visible: true, linkFace: false, shareHoldings: false, shareWeek: false, nextChangeAt: null, requests: 0 };
const render = (social: Partial<MySocial>, variant: "card" | "row" = "row") =>
  renderToStaticMarkup(createElement(FriendsAllOffer, { social: { ...NEW, ...social }, variant }));

describe("what turning everything on shares, said before the tap", () => {
  it("says who sees the shared links, that saved previews stay, the week's range and the full warning", () => {
    const html = render({});
    expect(html).toContain("to anyone who opens or guesses your shared links");
    expect(html).toContain("Previews other apps already saved cannot be removed.");
    expect(html).toContain("over the range a friend picks, up to 90 days or since your first buy");
    expect(html).toContain("With few holdings, friends may guess what you hold and in what share.");
    expect(html).toContain("You can turn any of them off later, one at a time.");
  });

  it("says plainly that a hidden profile is shown again, and only then", () => {
    expect(render({ visible: false })).toContain("Your profile is hidden now. This shows it again.");
    expect(render({})).not.toContain("This shows it again.");
  });

  it("promises the XP while it can be paid, and not while staff have hidden the card", () => {
    expect(render({})).toContain("+100 XP, once");
    expect(render({}, "card")).toContain("The XP stays yours");
    const hidden = render({ visible: false, staffHidden: true, linkFace: true });
    expect(hidden).not.toContain("+100 XP");
    expect(hidden).not.toContain("The XP stays yours");
    expect(hidden).not.toContain("This shows it again.");
  });

  it("names one summary line per feature it turns on, the same list the tap sends", async () => {
    const { FRIEND_FEATURES } = await import("@/lib/friends-all");
    const named = [...render({}).matchAll(/data-feature="([^"]+)"/g)].map((m) => m[1]);
    expect(named).toEqual([...FRIEND_FEATURES]);
  });
});
