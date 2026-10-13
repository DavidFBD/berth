import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COPY } from "@/lib/copy";
import type { CardAnswer, Viewer } from "@/lib/social-types";

// The hooks reach the wallet SDKs, which do not load under node; the views take no hook of theirs.
vi.mock("@/hooks/use-social", () => ({ useAccountNotice: () => ({ due: false, close: () => {} }), useFirstFriend: () => ({ offer: null }) }));
const { ProfileCardView } = await import("./profile-card");
const { FirstFriendLineView } = await import("@/components/board/first-friend-line");

/**
 * The founder as markup (lib/server/social/founder): his card says his
 * holdings are for comparison, not advice, names only, and nothing on it or
 * on the first friend strip is a buy.
 */

const noop = () => {};
const handlers = { onSalute: noop, onFriend: noop, onBlock: noop, onReport: noop };
const CARD = { handle: "david", avatarId: "buoy", xp: 2000, memberSince: "2026-09", salutes: 9 };
const viewer = (extra: Partial<Viewer> = {}): Viewer => ({ relation: "friends", saluted: false, hasEmail: true, hasHandle: true, ...extra });

function card(answer: Extract<CardAnswer, { found: true }>) {
  return renderToStaticMarkup(createElement(ProfileCardView, { answer, handlers }));
}

describe("the founder's card", () => {
  it("says his holdings are not advice, under the names, with no buy", () => {
    const html = card({ found: true, card: { ...CARD, founder: true }, viewer: viewer({ sharesHoldings: true }), holds: ["NVDA", "AAPL"] });
    expect(html).toContain("data-card-holds");
    expect(html).toContain(COPY.social.founderHoldsNote.replace("'", "&#x27;"));
    expect(html).not.toMatch(/>\s*Buy\b/);
    expect(html).not.toMatch(/\$\d/);
  });

  it("asks a friend whose switch is off to turn it on, and says nothing of holdings", () => {
    const html = card({ found: true, card: { ...CARD, founder: true }, viewer: viewer() });
    expect(html).toContain("data-founder-share-hint");
    expect(html).not.toContain("data-founder-note");
  });

  it("is an ordinary card when it is not his", () => {
    const html = card({ found: true, card: CARD, viewer: viewer({ sharesHoldings: true }), holds: ["NVDA"] });
    expect(html).not.toContain("data-founder-note");
    expect(html).not.toContain("data-founder-share-hint");
  });
});

describe("the first friend strip", () => {
  it("introduces David, offers Add David and your own link, and never a buy", () => {
    const html = renderToStaticMarkup(
      createElement(FirstFriendLineView, { offer: { handle: "david", avatarId: "buoy", xp: 2000 }, onAdd: noop, onShareLink: noop, onDismiss: noop }),
    );
    expect(html).toContain(COPY.firstFriend.founderName);
    expect(html).toContain(COPY.firstFriend.add);
    expect(html).toContain(COPY.firstFriend.shareLink);
    expect(html).not.toMatch(/\bBuy\b/);
  });

  it("says nothing without an offer", () => {
    expect(renderToStaticMarkup(createElement(FirstFriendLineView, { offer: null, onAdd: noop, onShareLink: noop, onDismiss: noop }))).toBe("");
  });
});
