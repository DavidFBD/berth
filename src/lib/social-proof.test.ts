import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";
import {
  FRIEND_FACES_SHOWN,
  FRIEND_HOLDINGS_MAX_AGE_DAYS,
  FRIEND_NAMES_SHOWN,
  MOST_BOUGHT_MIN_ACCOUNT_DAYS,
  MOST_BOUGHT_MIN_BUY_USD,
  MOST_BOUGHT_MIN_PEOPLE,
  MOST_BOUGHT_MIN_PER_LISTING,
  friendsHoldingByListing,
  holdsListings,
  holdsSomething,
  MOST_BOUGHT_FIRST_WEEK,
  mondayOf,
  nextPublishAt,
  publishedWeek,
  personOf,
  rankMostBought,
  shownCount,
  type AccountFact,
  type BuyFact,
} from "./social-proof";

const LISTED = ["NVDA", "AAPL", "TSLA", "QQQ"];
const END = new Date("2026-10-02T00:00:00Z");
const OLD = "2026-09-01T00:00:00Z";

/** An eligible person: old enough, with an email, not staff, unless told otherwise. */
const acct = (id: string, extra: Partial<AccountFact> = {}): AccountFact => ({
  id,
  retiredInto: null,
  staff: false,
  createdAt: OLD,
  hasEmail: true,
  ...extra,
});
const accounts = (...facts: AccountFact[]) => new Map(facts.map((fact) => [fact.id, fact]));
/** Accounts for every id in `ids`, eligible. */
const everyone = (...ids: string[]) => accounts(...ids.map((id) => acct(id)));
const buys = (symbol: string, usd: number | null, ...users: string[]): BuyFact[] => users.map((userId) => ({ userId, symbol, usd }));
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const rank = (facts: BuyFact[], known: Map<string, AccountFact>) => rankMostBought(facts, known, LISTED, END);

describe("the published week", () => {
  it("is Monday to Monday UTC, published the Tuesday after it ends", () => {
    expect(mondayOf(new Date("2026-10-14T23:00:00Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(mondayOf(new Date("2026-10-12T00:00:00Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(mondayOf(new Date("2026-10-11T23:59:59Z")).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    // Monday 19 Oct is still settling: the week of 12 Oct is not out until Tuesday.
    expect(publishedWeek(new Date("2026-10-19T23:59:59Z"))?.label).toBe("2026-10-05");
    expect(publishedWeek(new Date("2026-10-20T00:00:00Z"))?.label).toBe("2026-10-12");
    const week = publishedWeek(new Date("2026-10-23T12:00:00Z"))!;
    expect(week.start.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });

  it("starts no earlier than the first week after the policy took effect, and shows nothing until it closes", () => {
    expect(MOST_BOUGHT_FIRST_WEEK).toBe("2026-10-05");
    expect(new Date(`${MOST_BOUGHT_FIRST_WEEK}T00:00:00Z`).getUTCDay()).toBe(1);
    for (const at of ["2026-10-02T12:00:00Z", "2026-10-06T00:00:00Z", "2026-10-12T00:00:00Z", "2026-10-12T23:59:59Z"]) {
      expect(publishedWeek(new Date(at))).toBeNull();
    }
    expect(publishedWeek(new Date("2026-10-13T00:00:00Z"))?.label).toBe("2026-10-05");
  });

  it("says when the next week comes out", () => {
    expect(nextPublishAt(new Date("2026-10-02T12:00:00Z")).toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(nextPublishAt(new Date("2026-10-13T00:00:00Z")).toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(nextPublishAt(new Date("2026-10-19T23:00:00Z")).toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });
});

describe("most bought this week", () => {
  it("counts people, not buys: one person buying five times is one", () => {
    const people = ids("p", 10);
    const facts = [...buys("NVDA", 20, "p0", "p0", "p0", ...people.slice(1, 5)), ...buys("AAPL", 20, ...people.slice(5))];
    expect(rank(facts, everyone(...people))).toEqual([
      { symbol: "NVDA", people: 5, plus: false },
      { symbol: "AAPL", people: 5, plus: false },
    ]);
  });

  it("shows nothing below ten people in total, and exactly ten is enough", () => {
    expect(MOST_BOUGHT_MIN_PEOPLE).toBe(10);
    const people = ids("p", 10);
    const nine = buys("NVDA", 20, ...people.slice(0, 9));
    expect(rank(nine, everyone(...people))).toEqual([]);
    expect(rank([...nine, ...buys("AAPL", 20, "p9")], everyone(...people))).toEqual([{ symbol: "NVDA", people: 9, plus: false }]);
  });

  it("hides a listing with fewer than five buyers, and keeps one with exactly five", () => {
    expect(MOST_BOUGHT_MIN_PER_LISTING).toBe(5);
    const people = ids("p", 10);
    const facts = [...buys("NVDA", 20, ...people.slice(0, 5)), ...buys("AAPL", 20, ...people.slice(5, 9)), ...buys("TSLA", 20, "p9")];
    expect(rank(facts, everyone(...people))).toEqual([{ symbol: "NVDA", people: 5, plus: false }]);
  });

  it("says counts above ten rounded down to a multiple of five, with a plus", () => {
    expect(shownCount(10)).toEqual({ people: 10, plus: false });
    expect(shownCount(11)).toEqual({ people: 10, plus: true });
    expect(shownCount(14)).toEqual({ people: 10, plus: true });
    expect(shownCount(15)).toEqual({ people: 15, plus: true });
    expect(shownCount(19)).toEqual({ people: 15, plus: true });
    expect(shownCount(7)).toEqual({ people: 7, plus: false });
  });

  it("ranks on the count as shown, so 12 and 13 tie in the registry's order", () => {
    const people = ids("p", 13);
    const facts = [...buys("TSLA", 20, ...people), ...buys("NVDA", 20, ...people.slice(0, 12))];
    expect(rank(facts, everyone(...people))).toEqual([
      { symbol: "NVDA", people: 10, plus: true },
      { symbol: "TSLA", people: 10, plus: true },
    ]);
  });

  it("counts only buys of at least $10, and none whose value is unknown", () => {
    expect(MOST_BOUGHT_MIN_BUY_USD).toBe(10);
    const people = ids("p", 10);
    const facts = [...buys("NVDA", 10, ...people.slice(0, 8)), ...buys("NVDA", 9.99, "p8"), ...buys("NVDA", null, "p9")];
    expect(rank(facts, everyone(...people))).toEqual([]);
    expect(rank([...facts, ...buys("AAPL", 25, "p8", "p9")], everyone(...people))).toEqual([{ symbol: "NVDA", people: 8, plus: false }]);
  });

  it("counts only accounts a week old at the week's close, with a verified email", () => {
    expect(MOST_BOUGHT_MIN_ACCOUNT_DAYS).toBe(7);
    const people = ids("p", 10);
    const facts = buys("NVDA", 20, ...people);
    const sevenDays = new Date(END.getTime() - 7 * 86_400_000).toISOString();
    const justUnder = new Date(END.getTime() - 7 * 86_400_000 + 1000).toISOString();
    expect(rank(facts, accounts(...people.slice(1).map((id) => acct(id)), acct("p0", { createdAt: sevenDays })))).toHaveLength(1);
    expect(rank(facts, accounts(...people.slice(1).map((id) => acct(id)), acct("p0", { createdAt: justUnder })))).toEqual([]);
    expect(rank(facts, accounts(...people.slice(1).map((id) => acct(id)), acct("p0", { hasEmail: false })))).toEqual([]);
    // An account nobody could read about is not counted either.
    expect(rank(facts, everyone(...people.slice(1)))).toEqual([]);
  });

  it("counts merged accounts as one person: the survivor's email, the oldest account's age", () => {
    const people = ids("p", 9);
    // a2 is new and has no email, but it was merged into p0, which is old and verified.
    const known = accounts(...people.map((id) => acct(id)), acct("a2", { retiredInto: "p0", createdAt: "2026-10-01T00:00:00Z", hasEmail: false }));
    const facts = [...buys("NVDA", 20, "a2", "p0", "p1", "p2", "p3"), ...buys("AAPL", 20, ...people.slice(4))];
    // p0 and a2 are one person: nine people in all, too few.
    expect(rank(facts, known)).toEqual([]);
    // A new survivor inherits the age of the old account merged into it.
    const young = accounts(...people.map((id) => acct(id)), acct("n", { createdAt: "2026-10-01T00:00:00Z" }), acct("o", { retiredInto: "n" }));
    expect(rank([...facts, ...buys("NVDA", 20, "n")], young)).toEqual([
      { symbol: "NVDA", people: 5, plus: false },
      { symbol: "AAPL", people: 5, plus: false },
    ]);
  });

  it("leaves staff out entirely, including a staff account merged into another", () => {
    const people = ids("p", 10);
    const facts = [...buys("NVDA", 20, ...people.slice(0, 5)), ...buys("AAPL", 20, ...people.slice(5))];
    expect(rank(facts, everyone(...people))).toHaveLength(2);
    expect(rank(facts, accounts(...people.slice(1).map((id) => acct(id)), acct("p0", { staff: true })))).toEqual([]);
    const merged = accounts(...people.map((id) => acct(id)), acct("s", { staff: true, retiredInto: "p0" }));
    expect(rank(facts, merged)).toEqual([]);
  });

  it("never counts what is not listed, such as cash", () => {
    const people = ids("p", 10);
    expect(rank(buys("SGOV", 100, ...people), everyone(...people))).toEqual([]);
  });

  it("follows a merge chain to its end and stops at a loop", () => {
    const chain = accounts(acct("a", { retiredInto: "b" }), acct("b", { retiredInto: "c" }));
    expect(personOf("a", chain)).toBe("c");
    expect(personOf("z", chain)).toBe("z");
    const loop = accounts(acct("a", { retiredInto: "b" }), acct("b", { retiredInto: "a" }));
    expect(["a", "b"]).toContain(personOf("a", loop));
  });
});

describe("what friends hold", () => {
  it("counts friends per listing, names one or two, and only counts past that", () => {
    expect(FRIEND_NAMES_SHOWN).toBe(2);
    const lines = friendsHoldingByListing(
      [
        { handle: "mara", holdings: [{ symbol: "NVDA", quantity: 1, price: 180 }, { symbol: "AAPL", quantity: 0.5, price: 230 }] },
        { handle: "anchor", holdings: [{ symbol: "NVDA", quantity: 2, price: 180 }, { symbol: "AAPL", quantity: 1, price: 230 }] },
        { handle: "quay", holdings: [{ symbol: "NVDA", quantity: 0.01, price: 180 }] },
      ],
      LISTED,
    );
    expect(lines.map(({ symbol, count, names }) => ({ symbol, count, names }))).toEqual([
      { symbol: "NVDA", count: 3, names: [] },
      { symbol: "AAPL", count: 2, names: ["anchor", "mara"] },
    ]);
  });

  it("gives each line at most four faces, sorted by username, and the count says the rest", () => {
    expect(FRIEND_FACES_SHOWN).toBe(4);
    const six = ["tide", "anchor", "quay", "mara", "juno", "bollard"].map((handle, i) => ({
      handle,
      avatarId: `face_${handle}`,
      level: i + 1,
      holdings: [{ symbol: "NVDA", quantity: 1, price: 180 }],
    }));
    const [nvda] = friendsHoldingByListing(six, LISTED);
    expect(nvda.count).toBe(6);
    expect(nvda.names).toEqual([]);
    expect(nvda.faces).toEqual([
      { handle: "anchor", avatarId: "face_anchor", level: 2 },
      { handle: "bollard", avatarId: "face_bollard", level: 6 },
      { handle: "juno", avatarId: "face_juno", level: 5 },
      { handle: "mara", avatarId: "face_mara", level: 4 },
    ]);
    const [two] = friendsHoldingByListing(six.slice(0, 2), LISTED);
    expect(two.faces.map((face) => face.handle)).toEqual(["anchor", "tide"]);
    expect(two.names).toEqual(["anchor", "tide"]);
  });

  it("puts a face only on a friend counted in that line, with nothing beyond a username, an avatar and a level", () => {
    const lines = friendsHoldingByListing(
      [
        { handle: "mara", avatarId: "ring", level: 6, holdings: [{ symbol: "NVDA", quantity: 2, price: 180 }] },
        { handle: "dusty", avatarId: "rope", level: 3, holdings: [{ symbol: "NVDA", quantity: 0.0001, price: 180 }, { symbol: "AAPL", quantity: 1, price: 230 }] },
        { handle: "cashy", avatarId: "compass", level: 2, holdings: [{ symbol: "SGOV", quantity: 10, price: 100 }] },
      ],
      LISTED,
    );
    expect(lines.find((line) => line.symbol === "NVDA")?.faces.map((face) => face.handle)).toEqual(["mara"]);
    expect(lines.find((line) => line.symbol === "AAPL")?.faces.map((face) => face.handle)).toEqual(["dusty"]);
    expect(JSON.stringify(lines)).not.toMatch(/cashy|compass|SGOV/);
    for (const face of lines.flatMap((line) => line.faces)) expect(Object.keys(face).sort()).toEqual(["avatarId", "handle", "level"]);
    expect(JSON.stringify(lines)).not.toMatch(/quantity|price|xp|180|230/);
  });

  it("never says an amount, and ignores dust, nothing and cash", () => {
    const lines = friendsHoldingByListing(
      [{ handle: "mara", holdings: [{ symbol: "NVDA", quantity: 0.0001, price: 180 }, { symbol: "TSLA", quantity: 0 }, { symbol: "SGOV", quantity: 10, price: 100 }] }],
      LISTED,
    );
    expect(lines).toEqual([]);
    expect(JSON.stringify(friendsHoldingByListing([{ handle: "m", holdings: [{ symbol: "NVDA", quantity: 3.25, price: 180 }] }], LISTED))).not.toMatch(/3\.25|180/);
  });

  it("lists one friend's listings in the registry's order, for their card", () => {
    expect(holdsListings([{ symbol: "TSLA", quantity: 1, price: 400 }, { symbol: "NVDA", quantity: 1, price: 180 }, { symbol: "AAPL", quantity: 0 }], LISTED)).toEqual([
      "NVDA",
      "TSLA",
    ]);
  });

  it("counts a holding whose price is not known, and keeps a day for three days at most", () => {
    expect(holdsSomething({ quantity: 1, price: null })).toBe(true);
    expect(holdsSomething({ quantity: 0.001, price: 1 })).toBe(false);
    expect(holdsSomething({ quantity: -1, price: 1 })).toBe(false);
    expect(FRIEND_HOLDINGS_MAX_AGE_DAYS).toBe(3);
  });
});

describe("the words", () => {
  it("say a count of people and nothing else", () => {
    expect(COPY.mostBoughtTitle("Oct 5")).toBe("Most bought on Berth, the week of Oct 5");
    expect(COPY.mostBoughtRow(7, false)).toBe("Bought by 7 people");
    expect(COPY.mostBoughtRow(15, true)).toBe("Bought by 15+ people");
    expect(COPY.friendsHold(1, ["mara"])).toBe("Held by your friend mara");
    expect(COPY.friendsHold(2, ["anchor", "mara"])).toBe("Held by your friends anchor and mara");
    expect(COPY.friendsHold(5, [])).toBe("Held by 5 of your friends");
    expect(COPY.social.cardHolds(["NVIDIA"])).toBe("Holds NVIDIA.");
    expect(COPY.social.cardHolds(["NVIDIA", "Apple", "Tesla"])).toBe("Holds NVIDIA, Apple and Tesla.");
    const texts = [
      COPY.mostBoughtTitle("Oct 5"),
      COPY.mostBoughtRow(15, true),
      COPY.social.cardShareNote,
      COPY.friendsHold(4, []),
      COPY.social.shareHoldings,
      COPY.social.shareHoldingsSub,
      COPY.social.acceptHoldingsNote,
      COPY.social.holdingOff,
      COPY.socialNotice.text,
    ];
    for (const text of texts) expect(text).not.toMatch(/ [-–—] |—|–|[↑↓▲▼]|hot|trending|popular|best/i);
  });

  it("promise nothing the code does not do", () => {
    expect(COPY.social.shareHoldingsSub).toMatch(/Off unless you turn it on/);
    expect(COPY.firstPath.usernameSub).not.toMatch(/never shows .*what you own/);
    expect(COPY.social.hideSub).toMatch(/do not see what you hold/);
    expect(COPY.privacyPolicy.status).toBe("Effective 6 October 2026.");
    expect(COPY.social.shareHoldingsSub).toMatch(/including friends you add later/);
  });

  /**
   * Every sentence of user-facing copy that makes an absolute claim about
   * holdings ("never ... what you own", "nothing else") must be one of the
   * reviewed ones below, each true as the code stands: link previews and
   * the friends board never show holdings, and the rest are qualified. A new
   * absolute line fails here until someone checks it against the code.
   */
  it("make no unreviewed absolute claim about what people hold", () => {
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(COPY);
    const sentences = strings.flatMap((text) => text.split(/(?<=\.)\s+/));
    const absolute = /\b(never|nothing else|no one|not)\b/i;
    const holdings = /\b(what you own|what you hold|holdings|what they hold)\b/i;
    const claims = [...new Set(sentences.filter((sentence) => absolute.test(sentence) && holdings.test(sentence)))];
    const REVIEWED = new Set<string>(REVIEWED_CLAIMS);
    expect(claims.filter((claim) => !REVIEWED.has(claim))).toEqual([]);
  });
});

/** Absolute claims about holdings that were checked against the code (2026-10-02). */
const REVIEWED_CLAIMS: readonly string[] = [
  // Qualified: holdings only to friends, only if switched on.
  "Your profile never shows money, and shows what you hold only to friends if you turn it on.",
  "Never your email, your wallets or your money, and what you own only to friends, as below.",
  "While hidden, your username finds no one, and friends do not see what you hold.",
  // The link preview (lib/server/og-people) never carries holdings, switch or not.
  "Never your email, your wallets, your money or what you own.",
  // Not about who sees holdings.
  "Jev has not read the latest stories about what you own yet.",
  "Your change counts what your holdings did, not money you added or took out.",
];
