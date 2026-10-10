import { describe, expect, it } from "vitest";
import type { OrderFacts } from "@/lib/benchmark";
import { COPY } from "@/lib/copy";
import { TERMS_VERSION } from "@/lib/legal-version";
import { markAsOf } from "@/lib/marks";
import {
  alignWithFriend,
  friendWindow,
  returnSeries,
  roundTenth,
  windowAllowed,
  type FriendWeek,
} from "./friend-week";

/** A friend's account: NVDA at these closes, $100 bought on the first day and $100 more on the fourth. */
const CLOSES = { "2026-10-01": 10, "2026-10-02": 11, "2026-10-05": 9.9, "2026-10-06": 10.89, "2026-10-07": 10.89 };
const DAYS = Object.keys(CLOSES);
const NVDA = { dates: DAYS, values: Object.values(CLOSES) };

function account({ unpriced = false } = {}) {
  const orders: OrderFacts[] = [
    { symbol: "NVDA", direction: "buy", quantity: 10, usd: 100, placedAt: "2026-10-01T15:00:00.000Z" },
    { symbol: "NVDA", direction: "buy", quantity: 100 / 9.9, usd: unpriced ? null : 100, placedAt: "2026-10-05T15:00:00.000Z" },
  ];
  let quantity = 0;
  const days = DAYS.map((day) => {
    for (const order of orders) if (order.placedAt.startsWith(day)) quantity += order.quantity!;
    const price = CLOSES[day as keyof typeof CLOSES];
    return {
      day,
      value: quantity * price,
      asOf: markAsOf(day),
      holdings: [{ symbol: "NVDA", quantity, price, source: "mark" as const }],
      source: "snapshot" as const,
    };
  });
  return { days, orders, listingCloses: { NVDA } };
}

describe("a friend's line, percent only", () => {
  it("is the return so far from the first close, with money put in set aside", () => {
    const series = returnSeries(account())!;
    expect(series.map((point) => point.day)).toEqual(DAYS);
    expect(series[0].pct).toBe(0);
    expect(series[1].pct).toBeCloseTo(10, 6);
    // The second $100 is money in, not a return: the line never jumps with it.
    expect(series[2].pct).toBeLessThan(10);
    expect(series[2].pct).toBeGreaterThan(-10);
  });

  it("is refused when the return cannot be told", () => {
    expect(returnSeries(account({ unpriced: true }))).toBeNull();
    expect(returnSeries({ days: [], orders: [], listingCloses: {} })).toBeNull();
  });

  it("starts at 0% on the first close on or after the window's start, rounded to a tenth", () => {
    const week = friendWindow(returnSeries(account()), "2026-10-02")!;
    expect(week.from).toBe("2026-10-02");
    expect(week.days[0]).toEqual({ day: "2026-10-02", pct: 0 });
    for (const point of week.days) expect(point.pct).toBe(roundTenth(point.pct));
    // 199 / (110 + 100) on the day of the second buy, then 10.89 / 9.9: the
    // money put in is counted from the start of its day (lib/portfolio-history).
    expect(week.days.at(-1)!.pct).toBe(roundTenth(((199 / 210) * 1.1 - 1) * 100));
  });

  it("starts later when the friend's record does: the overlap", () => {
    const week = friendWindow(returnSeries(account()), "2026-09-20")!;
    expect(week.from).toBe("2026-10-01");
  });

  it("says nothing under two points", () => {
    expect(friendWindow(returnSeries(account()), "2026-10-07")).toBeNull();
    expect(friendWindow(returnSeries(account()), "2026-10-08")).toBeNull();
    expect(friendWindow(null, "2026-10-01")).toBeNull();
  });

  it("carries only days and percentages: never a value, holding, quantity or price", () => {
    const week = friendWindow(returnSeries(account()), "2026-10-01")!;
    expect(Object.keys(week).sort()).toEqual(["days", "from"]);
    for (const point of week.days) expect(Object.keys(point).sort()).toEqual(["day", "pct"]);
    expect(JSON.stringify(week)).not.toMatch(/value|holding|quantity|price|usd|NVDA/);
  });
});

describe("the window a viewer may ask for", () => {
  const today = "2026-10-09";

  it("lets 1W start at most ten days back, and never in the future", () => {
    expect(windowAllowed("1w", "2026-10-02", { today, ownFirstDay: null })).toBe(true);
    expect(windowAllowed("1w", "2026-09-29", { today, ownFirstDay: null })).toBe(true);
    expect(windowAllowed("1w", "2026-09-28", { today, ownFirstDay: null })).toBe(false);
    expect(windowAllowed("1w", "2026-10-10", { today, ownFirstDay: null })).toBe(false);
  });

  it("lets since first buy start no earlier than the viewer's own first day", () => {
    expect(windowAllowed("since", "2026-08-01", { today, ownFirstDay: "2026-08-01" })).toBe(true);
    expect(windowAllowed("since", "2026-07-31", { today, ownFirstDay: "2026-08-01" })).toBe(false);
    expect(windowAllowed("since", "2026-08-01", { today, ownFirstDay: null })).toBe(false);
  });

  it("refuses any other range and anything that is not a day", () => {
    expect(windowAllowed("1m", "2026-10-02", { today, ownFirstDay: "2026-01-01" })).toBe(false);
    expect(windowAllowed("all", "2026-10-02", { today, ownFirstDay: "2026-01-01" })).toBe(false);
    expect(windowAllowed("1w", "2026-10-2", { today, ownFirstDay: null })).toBe(false);
    expect(windowAllowed("1w", 20261002, { today, ownFirstDay: null })).toBe(false);
  });
});

describe("two lines over the same days", () => {
  const you = [
    { day: "2026-10-02", returnPct: 0 },
    { day: "2026-10-05", returnPct: 2 },
    { day: "2026-10-06", returnPct: 4.04 },
    { day: "2026-10-07", returnPct: 1 },
    // Today's live point: yours only.
    { day: "2026-10-08", returnPct: 3 },
  ];

  it("keeps a 1W window that both lines fill as it is", () => {
    const week: FriendWeek = {
      from: "2026-10-02",
      days: [
        { day: "2026-10-02", pct: 0 },
        { day: "2026-10-05", pct: -1 },
        { day: "2026-10-06", pct: 0.5 },
        { day: "2026-10-07", pct: 1.2 },
      ],
    };
    const aligned = alignWithFriend(you, week)!;
    expect(aligned.anchor).toBe("2026-10-02");
    expect(aligned.points.map((point) => point.you)).toEqual(you.map((point) => point.returnPct));
    expect(aligned.points.map((point) => point.friend)).toEqual([0, -1, 0.5, 1.2, null]);
  });

  it("rebases both to 0% at the later start, so neither line has a head start", () => {
    const week: FriendWeek = {
      from: "2026-10-05",
      days: [
        { day: "2026-10-05", pct: 0 },
        { day: "2026-10-06", pct: 1 },
      ],
    };
    const aligned = alignWithFriend(you, week)!;
    expect(aligned.anchor).toBe("2026-10-05");
    expect(aligned.points[0]).toEqual({ day: "2026-10-05", you: 0, friend: 0 });
    // 1.0404 / 1.02 - 1: your return from the shared start, not from your own.
    expect(aligned.points[1].you).toBeCloseTo(2, 6);
    expect(aligned.points[1].friend).toBeCloseTo(1, 6);
  });

  it("anchors on the first day both lines have", () => {
    const week: FriendWeek = {
      from: "2026-10-03",
      days: [
        { day: "2026-10-03", pct: 0 },
        { day: "2026-10-06", pct: 2 },
        { day: "2026-10-07", pct: 3 },
      ],
    };
    const aligned = alignWithFriend(you, week)!;
    expect(aligned.anchor).toBe("2026-10-06");
    expect(aligned.points[0]).toEqual({ day: "2026-10-06", you: 0, friend: 0 });
    expect(aligned.points[1].friend).toBeCloseTo((1.03 / 1.02 - 1) * 100, 6);
  });

  it("draws nothing when the lines do not share two days", () => {
    expect(alignWithFriend(you, null)).toBeNull();
    expect(alignWithFriend(you, { from: "2026-10-08", days: [{ day: "2026-10-08", pct: 0 }, { day: "2026-10-09", pct: 1 }] })).toBeNull();
  });
});

describe("the words around it", () => {
  const policy = COPY.privacyPolicy.sections.flatMap((section) => [...section.body, ...(section.list ?? [])]).join("\n");

  it("asks in plain words, off by default, reciprocal, never money", () => {
    const sub = COPY.social.shareWeekSub;
    expect(COPY.social.shareWeek).toBe("Let my friends compare their week with mine");
    for (const part of [
      "in percent only",
      "With only a few holdings, a friend may be able to tell from your line what you hold and in what share.",
      "Never how much money",
      "You see theirs only while yours is on",
      "Off unless you turn it on",
    ]) {
      expect(sub).toContain(part);
    }
    for (const text of [COPY.social.shareWeek, sub, COPY.portfolioFriendFrom("Oct 2"), COPY.portfolioFriendRanges("mara"), COPY.portfolioFriendNone("mara")]) {
      expect(text).not.toMatch(/ [-–—] |[–—]/);
      expect(text).not.toMatch(/beat|win|lead|rank/i);
    }
  });

  it("is in the privacy policy, with a line in what changed, and the terms version is not bumped", () => {
    expect(policy).toContain("If you turn on Let my friends compare their week with mine");
    expect(policy).toContain("in percent, day by day");
    expect(policy).toContain("you see theirs only while yours is on");
    // Said where consent is given and in the policy in the same words (review M1).
    expect(policy).toContain("With only a few holdings, a friend may be able to tell from your line what you hold and in what share.");
    const changed = COPY.privacyPolicy.sections.find((section) => section.id === "what-changed")!;
    expect(changed.list?.at(-1)).toContain("Compare with friends");
    expect(changed.body[0]).toContain("10 October 2026");
    expect(TERMS_VERSION).toBe("2026-10-08");
  });
});
