import { describe, expect, it } from "vitest";
import {
  activeSkips,
  dismissFor,
  eligibleKinds,
  factsQuery,
  parseFacts,
  type NudgeFacts,
} from "@/lib/nudge";

const facts = (partial: Partial<NudgeFacts>): NudgeFacts => ({
  held: [],
  funds: false,
  canInvite: false,
  wallet: false,
  skip: [],
  ...partial,
});

describe("eligibleKinds", () => {
  it("tells an empty account how to begin, and nothing else", () => {
    expect(eligibleKinds(facts({}), false)).toEqual(["addFunds"]);
  });

  it("does not offer the card and bank top-up to a wallet account", () => {
    expect(eligibleKinds(facts({ wallet: true }), false)).toEqual([]);
  });

  it("points funds with nothing bought at the board", () => {
    expect(eligibleKinds(facts({ funds: true }), false)).toEqual(["firstBuy"]);
  });

  it("offers Cash only to someone who owns stock, has idle dollars and parks none", () => {
    expect(eligibleKinds(facts({ funds: true, held: ["NVDA"] }), false)).toEqual(["parkCash"]);
    expect(eligibleKinds(facts({ funds: true, held: ["NVDA", "SGOV"] }), false)).toEqual([]);
    expect(eligibleKinds(facts({ funds: false, held: ["NVDA"] }), false)).toEqual([]);
  });

  it("puts news about a holding first", () => {
    expect(eligibleKinds(facts({ held: ["NVDA"], canInvite: true }), true)).toEqual([
      "heldNews",
      "invite",
    ]);
  });

  it("never offers a dismissed line", () => {
    expect(eligibleKinds(facts({ canInvite: true, skip: ["invite", "addFunds"] }), false)).toEqual([]);
  });

  it("does not call parked cash a first buy", () => {
    expect(eligibleKinds(facts({ funds: true, held: ["SGOV"] }), false)).toEqual(["firstBuy"]);
  });
});

describe("parseFacts", () => {
  const known = new Set(["NVDA", "TSLA", "SGOV"]);

  it("keeps only known symbols and kinds, sorted and unique", () => {
    const parsed = parseFacts(
      new URLSearchParams("held=tsla,NVDA,NVDA,EVIL&funds=1&skip=invite,drain,invite"),
      known,
    );
    expect(parsed).toEqual({
      held: ["NVDA", "TSLA"],
      funds: true,
      canInvite: false,
      wallet: false,
      skip: ["invite"],
    });
  });

  it("round-trips through the query string", () => {
    const original = facts({
      held: ["NVDA", "SGOV"],
      funds: true,
      canInvite: true,
      wallet: true,
      skip: ["parkCash"],
    });
    expect(parseFacts(new URLSearchParams(factsQuery(original)), known)).toEqual({
      ...original,
      held: ["NVDA", "SGOV"].sort(),
    });
  });
});

describe("dismissals", () => {
  const now = 10 * 24 * 60 * 60 * 1000;

  it("keeps news away for a day and a standing line for a week", () => {
    expect(dismissFor("heldNews")).toBe(24 * 60 * 60 * 1000);
    expect(dismissFor("invite")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("forgets a dismissal once its window has passed", () => {
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    expect(activeSkips({ heldNews: twoDaysAgo, invite: twoDaysAgo, junk: now }, now)).toEqual(["invite"]);
  });
});
