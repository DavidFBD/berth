import { describe, expect, it } from "vitest";
import { founderId, isFounder, offersFirstFriend, type FirstFriendFacts } from "./founder";
import { friendsHoldingByListing } from "@/lib/social-proof";
import { COPY } from "@/lib/copy";

const ID = "46b223cd-fac6-48df-be5c-011e4d0f74c8";

describe("founderId", () => {
  it("reads one uuid from BERTH_FOUNDER_USER_ID, and is off otherwise", () => {
    expect(founderId({ BERTH_FOUNDER_USER_ID: ID })).toBe(ID);
    expect(founderId({ BERTH_FOUNDER_USER_ID: ` ${ID.toUpperCase()} ` })).toBe(ID);
    expect(founderId({})).toBeNull();
    expect(founderId({ BERTH_FOUNDER_USER_ID: "" })).toBeNull();
    expect(founderId({ BERTH_FOUNDER_USER_ID: "david" })).toBeNull();
  });

  it("names only that account", () => {
    expect(isFounder(ID, { BERTH_FOUNDER_USER_ID: ID })).toBe(true);
    expect(isFounder("09b3e623-e77f-4bba-85ae-aab506544fd2", { BERTH_FOUNDER_USER_ID: ID })).toBe(false);
    expect(isFounder(ID, {})).toBe(false);
    expect(isFounder(null, { BERTH_FOUNDER_USER_ID: ID })).toBe(false);
  });
});

describe("offersFirstFriend", () => {
  const base: FirstFriendFacts = {
    founderLive: true,
    self: false,
    hasEmail: true,
    hasHandle: true,
    friends: 0,
    outgoing: 0,
    founderVisible: true,
    closed: false,
  };

  it("offers him to an account with no friends", () => {
    expect(offersFirstFriend(base)).toBe(true);
  });

  it.each<[string, Partial<FirstFriendFacts>]>([
    ["the feature is off", { founderLive: false }],
    ["the viewer is the founder", { self: true }],
    ["no verified email", { hasEmail: false }],
    ["no username", { hasHandle: false }],
    ["a friend already", { friends: 1 }],
    ["a request out", { outgoing: 1 }],
    ["his card hidden from this viewer", { founderVisible: false }],
    ["closed by Not now or a first friend", { closed: true }],
  ])("does not when %s", (_, change) => {
    expect(offersFirstFriend({ ...base, ...change })).toBe(false);
  });
});

describe("his lines in Your friends hold", () => {
  it("carry founder, and no other line does", () => {
    const lines = friendsHoldingByListing(
      [
        { handle: "david", founder: true, holdings: [{ symbol: "NVDA", quantity: 1 }] },
        { handle: "mira", holdings: [{ symbol: "NVDA", quantity: 1 }, { symbol: "AAPL", quantity: 1 }] },
      ],
      ["NVDA", "AAPL"],
    );
    expect(lines.map((line) => [line.symbol, line.founder])).toEqual([
      ["NVDA", true],
      ["AAPL", undefined],
    ]);
  });
});

describe("the copy", () => {
  it("introduces him plainly, calls his holdings no advice, and uses no dashes", () => {
    expect(COPY.firstFriend.founderName).toBe("David, who builds Berth");
    expect(COPY.social.founderHoldsNote).toBe("David's holdings, shared for comparison, not advice.");
    const strings = [...Object.values(COPY.firstFriend), COPY.social.founderHoldsNote, COPY.social.founderShareHint];
    for (const text of strings) {
      expect(text).not.toMatch(/[—–]| - /);
      expect(text).not.toMatch(/\bbuy\b|Jev/i);
    }
  });
});
