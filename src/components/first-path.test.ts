import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { firstPath, type PathFacts, type PathStep } from "@/lib/first-path";

// The step bodies reach the wallet SDKs, which do not load under node; the
// card around them is what is under test here.
vi.mock("@/components/board/holdings-list", () => ({ TickerTile: () => null }));
vi.mock("@/components/avatar-picker", () => ({ AvatarPicker: () => null }));
vi.mock("@/components/social/name-picker", () => ({ NamePicker: () => null, NamePickerView: () => null }));
vi.mock("@/components/rewards-panel", () => ({ AddEmailBlock: () => null }));
vi.mock("@/components/social/social-section", () => ({ useShareFriendLink: () => ({ token: "t", share: async () => "shared" }) }));
vi.mock("@/hooks/use-profile", () => ({
  useProfile: () => ({ data: { xp: 25, avatarId: null, hasEmail: true, referralCode: null } }),
  useFirstPathRecord: () => ({ data: undefined }),
  useFirstPathWrite: () => ({ mutate: () => {} }),
}));
vi.mock("@/hooks/use-social", () => ({ useMySocial: () => ({ data: { handle: "gosia" } }) }));
const { FirstPathProvider, HomePathCard } = await import("./first-path");
type Value = import("./first-path").FirstPathValue;

const NONE: PathFacts = { avatarSet: false, usernameSet: false, hasEmail: true, funded: false, firstBuy: false, inviteSent: false };
const ALL: PathFacts = { avatarSet: true, usernameSet: true, hasEmail: true, funded: true, firstBuy: true, inviteSent: true };
const noop = () => {};

function value(facts: PathFacts, extra: Partial<Value> = {}, skipped: PathStep[] = []): Value {
  return {
    view: firstPath({ facts, record: { eligible: true, skipped, finished: false }, context: { account: "email", canBuy: true } }),
    facts,
    referred: false,
    account: "email",
    canBuy: true,
    done: null,
    skip: noop,
    unskip: noop,
    finish: noop,
    shared: noop,
    ...extra,
  };
}

const FOOTNOTE = "CAMPAIGN-LINE";
const slots = {
  money: (frame: { footer?: ReactNode }) => createElement("section", null, "MONEY", frame.footer),
  firstBuy: (frame: { footer?: ReactNode }, _title: string, note: ReactNode) => createElement("section", null, "BUY", note, frame.footer),
};

function render(v: Value): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      // Children as the third argument; the provider's props type them as required.
      createElement(FirstPathProvider as (props: { value: Value; children?: ReactNode }) => ReactNode, { value: v }, createElement(HomePathCard, { slots, footnote: FOOTNOTE })),
    ),
  );
}

describe("the campaign line under every path card", () => {
  it("stands under a step, the money and buy steps, a Done moment and You're set up", () => {
    expect(render(value(NONE))).toContain(FOOTNOTE);
    expect(render(value({ ...NONE, avatarSet: true, usernameSet: true }))).toContain(FOOTNOTE);
    expect(render(value({ ...NONE, avatarSet: true, usernameSet: true, funded: true }))).toContain(FOOTNOTE);
    expect(render(value({ ...NONE, avatarSet: true }, { done: "avatar" }))).toContain(FOOTNOTE);
    expect(render(value(ALL))).toContain(FOOTNOTE);
  });
});

describe("the path's words are exact", () => {
  it("says That is everything only when nothing was set aside", () => {
    expect(render(value(ALL))).toContain("That is everything.");
    const some = render(value({ ...ALL, usernameSet: false }, {}, ["username"]));
    expect(some).not.toContain("That is everything.");
    expect(some).toContain("Your account is ready.");
    expect(some).toContain("Pick a username");
  });

  it("says Invite sent only after a real share, Link copied otherwise", () => {
    const done = { done: "invite" as const };
    expect(render(value(ALL, { ...done, invitedHow: "shared" }))).toContain("Invite sent.");
    const copied = render(value(ALL, { ...done, invitedHow: "copied" }));
    expect(copied).toContain("Link copied.");
    expect(copied).not.toContain("Invite sent.");
  });

  it("says That was the last step only when nothing set aside is about to come back", () => {
    expect(render(value(ALL, { done: "invite" }))).toContain("That was the last step.");
    const back = render(value({ ...ALL, usernameSet: false }, { done: "invite" }, ["username"]));
    expect(back).not.toContain("That was the last step.");
  });

  it("draws the marks of steps to come in a faint ink, visible in both themes", () => {
    const html = render(value(NONE));
    expect(html).toContain("bg-foreground/15");
    expect(html).not.toMatch(/h-1 w-4 rounded-full bg-muted/);
  });
});
