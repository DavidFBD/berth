import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/copy";
import {
  MOST_HELD_FIRST_WEEK,
  MOST_HELD_LADDER,
  MOST_HELD_MIN_ACCOUNTS,
  MOST_HELD_MIN_HOLDING_USD,
  MOST_HELD_MIN_PER_LISTING,
  MOST_HELD_SHOWN,
  MOST_HELD_SNAPSHOT_DAYS,
  countsAsHeld,
  oneIn,
  rankMostHeld,
  snapshotDays,
  type HeldFact,
} from "./most-held";
import { MOST_BOUGHT_FIRST_WEEK, nextPublishAt, publishedWeek, type AccountFact } from "./social-proof";

const LISTED = ["NVDA", "AAPL", "TSLA", "QQQ"];
const END = new Date("2026-10-19T00:00:00Z");
const OLD = "2026-09-01T00:00:00Z";

const acct = (id: string, extra: Partial<AccountFact> = {}): AccountFact => ({
  id,
  retiredInto: null,
  staff: false,
  createdAt: OLD,
  hasEmail: true,
  ...extra,
});
const accountsOf = (...facts: AccountFact[]) => new Map(facts.map((fact) => [fact.id, fact]));
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
/** `users` each holding $100 of every symbol given. */
const holding = (users: string[], ...symbols: string[]): HeldFact[] =>
  users.map((userId) => ({ userId, holdings: symbols.map((symbol) => ({ symbol, quantity: 1, price: 100 })) }));
const everyone = (...groups: string[][]) => accountsOf(...groups.flat().map((id) => acct(id)));

describe("the rounding ladder", () => {
  it("says only 1 in 2, 3, 4, 5, 10 or 20", () => {
    expect(MOST_HELD_LADDER).toEqual([2, 3, 4, 5, 10, 20]);
  });

  it("never overstates the share: 1/N is never more than held/total", () => {
    // One assertion over the whole grid: 80k expect() calls take over 5 s on CI.
    const wrong: string[] = [];
    for (let total = 1; total <= 400; total += 1) {
      for (let held = 1; held <= total; held += 1) {
        const n = oneIn(held, total);
        if (n === null) {
          // Silent only when even 1 in 20 would overstate it.
          if (!(held * 20 < total)) wrong.push(`${held}/${total} silent`);
          continue;
        }
        if (!MOST_HELD_LADDER.includes(n)) wrong.push(`${held}/${total} off ladder ${n}`);
        if (!(held * n >= total)) wrong.push(`${held}/${total} overstates 1 in ${n}`);
        // And it is the tightest true rung: the next smaller N would overstate.
        const smaller = MOST_HELD_LADDER.filter((rung) => rung < n).at(-1);
        if (smaller !== undefined && !(held * smaller < total)) wrong.push(`${held}/${total} not tightest ${n}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("rounds toward the larger N at the edges", () => {
    expect(oneIn(50, 100)).toBe(2);
    expect(oneIn(49, 100)).toBe(3);
    expect(oneIn(34, 100)).toBe(3);
    expect(oneIn(33, 100)).toBe(4);
    expect(oneIn(25, 100)).toBe(4);
    expect(oneIn(24, 100)).toBe(5);
    expect(oneIn(20, 100)).toBe(5);
    expect(oneIn(19, 100)).toBe(10);
    expect(oneIn(10, 100)).toBe(10);
    expect(oneIn(9, 100)).toBe(20);
    expect(oneIn(5, 100)).toBe(20);
    expect(oneIn(4, 100)).toBeNull();
    // Everyone holding it still reads as 1 in 2: there is no "1 in 1".
    expect(oneIn(100, 100)).toBe(2);
  });

  it("says nothing for nonsense", () => {
    expect(oneIn(0, 100)).toBeNull();
    expect(oneIn(5, 0)).toBeNull();
    expect(oneIn(101, 100)).toBeNull();
  });
});

describe("the thresholds", () => {
  it("are 20 per listing and 50 in all", () => {
    expect(MOST_HELD_MIN_PER_LISTING).toBe(20);
    expect(MOST_HELD_MIN_ACCOUNTS).toBe(50);
    expect(MOST_HELD_MIN_HOLDING_USD).toBe(10);
  });

  it("shows nothing while fewer than 50 accounts hold anything, and switches on at 50", () => {
    const nvda = ids("n", 25);
    const rest49 = ids("r", 24);
    expect(rankMostHeld([...holding(nvda, "NVDA"), ...holding(rest49, "AAPL")], everyone(nvda, rest49), LISTED, END)).toEqual([]);
    const rest50 = ids("r", 25);
    expect(rankMostHeld([...holding(nvda, "NVDA"), ...holding(rest50, "AAPL")], everyone(nvda, rest50), LISTED, END)).toEqual([
      { symbol: "NVDA", oneIn: 2 },
      { symbol: "AAPL", oneIn: 2 },
    ]);
  });

  it("leaves out a listing held by 19, and shows it at 20", () => {
    const base = ids("b", 40);
    const tsla19 = ids("t", 19);
    const facts19 = [...holding(base, "NVDA"), ...holding(tsla19, "TSLA")];
    expect(rankMostHeld(facts19, everyone(base, tsla19), LISTED, END)).toEqual([{ symbol: "NVDA", oneIn: 2 }]);
    const tsla20 = ids("t", 20);
    const facts20 = [...holding(base, "NVDA"), ...holding(tsla20, "TSLA")];
    // 40 of 60 hold Nvidia (1 in 2), 20 of 60 hold Tesla (1 in 3).
    expect(rankMostHeld(facts20, everyone(base, tsla20), LISTED, END)).toEqual([
      { symbol: "NVDA", oneIn: 2 },
      { symbol: "TSLA", oneIn: 3 },
    ]);
  });

  it("leaves out a listing held by fewer than 1 in 20, however many hold it", () => {
    const base = ids("b", 500);
    const few = base.slice(0, 24);
    const facts = [...holding(base, "NVDA"), ...holding(few, "QQQ")];
    expect(rankMostHeld(facts, everyone(base), LISTED, END)).toEqual([{ symbol: "NVDA", oneIn: 2 }]);
  });
});

describe("who and what is counted", () => {
  const base = ids("b", 60);

  it("counts people, folding merges, and a person once however many accounts hold it", () => {
    const facts = [...holding(base, "NVDA"), ...holding(["old0"], "AAPL")];
    // old0 merged into b0: still 60 people, and b0 now holds Apple too (1 of 60: hidden).
    const known = accountsOf(...base.map((id) => acct(id)), acct("old0", { retiredInto: "b0" }));
    expect(rankMostHeld(facts, known, LISTED, END)).toEqual([{ symbol: "NVDA", oneIn: 2 }]);
  });

  it("leaves out staff, accounts without an email and accounts under a week old, from the base too", () => {
    const tsla = base.slice(0, 20);
    const known = accountsOf(
      ...base.map((id, i) => acct(id, i === 0 ? { staff: true } : i === 1 ? { hasEmail: false } : i === 2 ? { createdAt: "2026-10-15T00:00:00Z" } : {})),
    );
    // Three of the twenty Tesla holders drop out: 17 is under the floor. The base is 57.
    expect(rankMostHeld([...holding(base, "NVDA"), ...holding(tsla, "TSLA")], known, LISTED, END)).toEqual([{ symbol: "NVDA", oneIn: 2 }]);
  });

  it("does not count dust, an unpriced holding, a holding under $10, cash or a delisted symbol", () => {
    expect(countsAsHeld({ quantity: 1, price: 100 })).toBe(true);
    expect(countsAsHeld({ quantity: 0.1, price: 100 })).toBe(true);
    expect(countsAsHeld({ quantity: 0.099, price: 100 })).toBe(false);
    expect(countsAsHeld({ quantity: 5, price: null })).toBe(false);
    expect(countsAsHeld({ quantity: 0, price: 100 })).toBe(false);
    const small: HeldFact[] = base.slice(0, 30).map((userId) => ({ userId, holdings: [{ symbol: "TSLA", quantity: 0.05, price: 100 }] }));
    const facts = [...holding(base, "NVDA", "SGOV", "GONE"), ...small];
    expect(rankMostHeld(facts, everyone(base), LISTED, END)).toEqual([{ symbol: "NVDA", oneIn: 2 }]);
  });

  it("ranks on the share as said, ties in the registry's order, and carries no count", () => {
    const facts = [...holding(base, "QQQ"), ...holding(base.slice(0, 30), "AAPL"), ...holding(base.slice(0, 31), "NVDA")];
    const rows = rankMostHeld(facts, everyone(base), LISTED, END);
    // Nvidia (31) and Apple (30) both read 1 in 2: registry order, not the hidden counts.
    expect(rows).toEqual([
      { symbol: "NVDA", oneIn: 2 },
      { symbol: "AAPL", oneIn: 2 },
      { symbol: "QQQ", oneIn: 2 },
    ]);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["oneIn", "symbol"]);
  });

  it("returns only the first five listings, never the rest that pass", () => {
    const listed = ["NVDA", "AAPL", "TSLA", "QQQ", "MSFT", "AMZN", "GOOGL"];
    // Every listing passes the floor; the two held least are not in the answer at all.
    const facts = listed.flatMap((symbol, i) => holding(base.slice(0, 60 - i * 5), symbol));
    const rows = rankMostHeld(facts, everyone(base), listed, END);
    expect(MOST_HELD_SHOWN).toBe(5);
    expect(rows.map((row) => row.symbol)).toEqual(["NVDA", "AAPL", "TSLA", "QQQ", "MSFT"]);
  });
});

describe("the week", () => {
  it("is Most bought's week, published the same Tuesday, from a later first week", () => {
    expect(MOST_HELD_FIRST_WEEK).toBe("2026-10-19");
    expect(MOST_HELD_FIRST_WEEK > MOST_BOUGHT_FIRST_WEEK).toBe(true);
    expect(new Date(`${MOST_HELD_FIRST_WEEK}T00:00:00Z`).getUTCDay()).toBe(1);
    for (const at of ["2026-10-20T00:00:00Z", "2026-10-26T23:59:59Z"]) expect(publishedWeek(new Date(at), MOST_HELD_FIRST_WEEK)).toBeNull();
    expect(publishedWeek(new Date("2026-10-27T00:00:00Z"), MOST_HELD_FIRST_WEEK)?.label).toBe("2026-10-19");
    // From then on it is exactly Most bought's week.
    for (const at of ["2026-10-27T00:00:00Z", "2026-11-02T23:59:59Z", "2026-11-03T00:00:00Z", "2027-01-05T12:00:00Z"]) {
      expect(publishedWeek(new Date(at), MOST_HELD_FIRST_WEEK)?.label).toBe(publishedWeek(new Date(at))?.label);
    }
    expect(nextPublishAt(new Date("2026-10-05T12:00:00Z"), MOST_HELD_FIRST_WEEK).toISOString()).toBe("2026-10-27T00:00:00.000Z");
    expect(nextPublishAt(new Date("2026-10-27T00:00:00Z"), MOST_HELD_FIRST_WEEK).toISOString()).toBe("2026-11-03T00:00:00.000Z");
  });

  it("reads what was held from the whole week, Monday to Sunday, since records exist only on trading days", () => {
    expect(MOST_HELD_SNAPSHOT_DAYS).toBe(7);
    const week = publishedWeek(new Date("2026-10-27T00:00:00Z"), MOST_HELD_FIRST_WEEK)!;
    expect(snapshotDays(week)).toEqual({ from: "2026-10-19", to: "2026-10-26" });
    // Christmas 2026 falls on a Friday: the window still holds that week's Thursday.
    const christmas = publishedWeek(new Date("2026-12-29T00:00:00Z"), MOST_HELD_FIRST_WEEK)!;
    expect(snapshotDays(christmas)).toEqual({ from: "2026-12-21", to: "2026-12-28" });
  });

  it("counts no week that began before the privacy policy disclosed Most held, and the policy in force still does", () => {
    // The policy that first said so took effect on 8 October 2026 (TERMS_VERSION 2026-10-08). Later
    // versions keep the paragraph unchanged (the 30 October one only adds the New stocks email), so
    // the bar is when the disclosure began, not the date of the policy now in force.
    const DISCLOSED_FROM = Date.UTC(2026, 9, 8);
    expect(Date.parse(`${MOST_HELD_FIRST_WEEK}T00:00:00Z`)).toBeGreaterThanOrEqual(DISCLOSED_FROM);
    const policy = JSON.stringify(COPY.privacyPolicy);
    expect(policy).toContain("Most held on Berth is public too.");
    expect(policy).toContain("The first week counted is the week of 19 October 2026");
  });
});

describe("the words", () => {
  it("say a rounded share and nothing else", () => {
    expect(COPY.mostHeldTitle("Oct 12")).toBe("Most held on Berth, the week of Oct 12");
    expect(COPY.mostHeldRow(4)).toBe("Held by 1 in 4 people who own a stock or fund on Berth");
    // The share is of counted people holding a stock or fund (rankMostHeld), never of all accounts: the row says so.
    for (const n of MOST_HELD_LADDER) expect(COPY.mostHeldRow(n)).toMatch(/people who own a stock or fund on Berth$/);
    for (const text of [COPY.mostHeldRow(4), COPY.mostHeldInfo]) {
      expect(text).not.toMatch(/accounts/);
      expect(text).toMatch(/people who own a stock or fund on Berth/);
    }
    const texts = [COPY.mostHeldTitle("Oct 12"), COPY.mostHeldRow(4), COPY.mostHeldInfo, COPY.mostHeldInfoLabel];
    for (const text of texts) {
      expect(text).not.toMatch(/ [-–—] |—|–|[↑↓▲▼]|hot|trending|popular|best|top/i);
      expect(text).not.toMatch(/\d+ (people|accounts) hold/);
    }
    expect(COPY.mostHeldInfo).toMatch(/once a week/);
    expect(COPY.mostHeldInfo).toMatch(/always rounded to the smaller share/);
    expect(COPY.mostHeldInfo).not.toMatch(/rounded down/);
    expect(COPY.mostHeldInfo).toMatch(/only once enough people hold it/);
  });
});
