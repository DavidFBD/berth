import { describe, expect, it } from "vitest";
import type { OrderFacts } from "@/lib/benchmark";
import { COPY } from "@/lib/copy";
import { TERMS_VERSION } from "@/lib/legal-version";
import { markAsOf } from "@/lib/marks";
import {
  FRIEND_WEEK_RANGES,
  FRIEND_WINDOW_MAX_DAYS,
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

  it("bounds each fixed range by its own reach: 14D twenty days, 30D forty, 90D a hundred", () => {
    const cases = [
      ["14d", "2026-09-19", "2026-09-18"],
      ["30d", "2026-08-30", "2026-08-29"],
      ["90d", "2026-07-01", "2026-06-30"],
    ] as const;
    const long = { today, ownFirstDay: "2026-01-01" };
    for (const [range, earliest, tooEarly] of cases) {
      expect(windowAllowed(range, earliest, long)).toBe(true);
      expect(windowAllowed(range, tooEarly, long)).toBe(false);
      expect(windowAllowed(range, "2026-10-10", long)).toBe(false);
    }
    // 1W's reach stays ten days: a 14D start is not a 1W one.
    expect(windowAllowed("1w", "2026-09-25", { today, ownFirstDay: null })).toBe(false);
    expect(Object.keys(FRIEND_WINDOW_MAX_DAYS)).toEqual(["1w", "14d", "30d", "90d"]);
    expect(FRIEND_WEEK_RANGES).toEqual(["1w", "14d", "30d", "90d", "since"]);
  });

  it("offers 14D, 30D and 90D only to a viewer whose own record reaches back that far, as the card does", () => {
    // Today minus 14, 30 and 90 days: Sep 25, Sep 9, Jul 11.
    expect(windowAllowed("14d", "2026-09-25", { today, ownFirstDay: "2026-09-25" })).toBe(true);
    expect(windowAllowed("14d", "2026-09-26", { today, ownFirstDay: "2026-09-26" })).toBe(false);
    expect(windowAllowed("30d", "2026-09-09", { today, ownFirstDay: "2026-09-09" })).toBe(true);
    expect(windowAllowed("30d", "2026-09-10", { today, ownFirstDay: "2026-09-10" })).toBe(false);
    expect(windowAllowed("90d", "2026-07-11", { today, ownFirstDay: "2026-07-11" })).toBe(true);
    expect(windowAllowed("90d", "2026-07-11", { today, ownFirstDay: "2026-10-08" })).toBe(false);
    expect(windowAllowed("90d", "2026-07-11", { today, ownFirstDay: null })).toBe(false);
    // 1W is offered before a week fills: its reach alone bounds it.
    expect(windowAllowed("1w", "2026-10-02", { today, ownFirstDay: "2026-10-08" })).toBe(true);
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

  it("aligns a 14D, 30D or 90D window by the same rule: the later of the range's start and the first day both have", () => {
    // Your line over a long window, from its first close; the friend's
    // record starts partway in, so both lines start at 0% there.
    const long = [
      { day: "2026-07-01", returnPct: 0 },
      { day: "2026-08-03", returnPct: 5 },
      { day: "2026-09-01", returnPct: 10.25 },
      { day: "2026-10-01", returnPct: 15.5 },
    ];
    const friendSeries = [
      { day: "2026-08-03", pct: 0 },
      { day: "2026-09-01", pct: 2 },
      { day: "2026-10-01", pct: 4 },
    ];
    for (const from of ["2026-07-01", "2026-08-03", "2026-09-01"]) {
      const week = friendWindow(friendSeries, from)!;
      const aligned = alignWithFriend(long.filter((point) => point.day >= from), week)!;
      const anchor = from > "2026-08-03" ? from : "2026-08-03";
      expect(aligned.anchor).toBe(anchor);
      expect(aligned.points[0]).toEqual({ day: anchor, you: 0, friend: 0 });
      const youBase = 1 + long.find((point) => point.day === anchor)!.returnPct / 100;
      const friendBase = 1 + friendSeries.find((point) => point.day === anchor)!.pct / 100;
      expect(aligned.points.at(-1)!.you).toBeCloseTo((1.155 / youBase - 1) * 100, 6);
      expect(aligned.points.at(-1)!.friend).toBeCloseTo(roundTenth((1.04 / friendBase - 1) * 100), 1);
    }
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
    // The switch is named by its title, the same name the privacy policy uses.
    expect(COPY.social.shareWeek).toBe("Compare weeks with friends");
    // The layered notice keeps the inference risk in view, not only behind Details.
    expect(COPY.social.shareWeekShort).toBe("Percent only. With few holdings, friends may guess what you hold.");
    for (const part of [
      "in percent only",
      "With only a few holdings, a friend may be able to tell from your line what you hold and in what share.",
      "Never how much money",
      "You see theirs only while yours is on",
      "Off unless you turn it on",
    ]) {
      expect(sub).toContain(part);
    }
    for (const text of [COPY.social.shareWeek, COPY.social.shareWeekShort, sub, COPY.portfolioFriendFrom("Oct 2"), COPY.portfolioFriendNone("mara")]) {
      expect(text).not.toMatch(/ [-–—] |[–—]/);
      expect(text).not.toMatch(/beat|win|lead|rank/i);
    }
  });

  it("is in the privacy policy, with a line in what changed, and the terms version is not bumped", () => {
    expect(policy).toContain("If you turn on Compare weeks with friends");
    expect(policy).toContain("in percent, day by day");
    expect(policy).toContain("over the days their page shows, which are the last week, the last 14, 30 or 90 days, or since the later of your two first buys.");
    expect(policy).not.toMatch(/page shows:/);
    expect(policy).toContain("you see theirs only while yours is on");
    // Said where consent is given and in the policy in the same words (review M1).
    expect(policy).toContain("With only a few holdings, a friend may be able to tell from your line what you hold and in what share.");
    const changed = COPY.privacyPolicy.sections.find((section) => section.id === "what-changed")!;
    expect(changed.list?.at(-5)).toContain("Compare with friends");
    // The longer windows, a line of their own the same day.
    expect(changed.list?.at(-4)).toContain("over the last 14, 30 or 90 days");
    // The switch names now match the app, dated today, effective date and terms version untouched.
    expect(changed.list?.at(-3)).toContain("On 11 October 2026 the names of the privacy switches");
    // The combined switch and its one time XP, the same day.
    expect(changed.list?.at(-2)).toContain("On 11 October 2026, Turn on all friend features");
    // New stocks emails, 30 October 2026 (the terms version bump).
    expect(changed.list?.at(-1)).toContain("On 30 October 2026, New stocks emails");
    // The intro names lines by what they say and when, never by position, so a new line cannot make it wrong.
    expect(changed.body[0]).not.toMatch(/\blast\b|third/);
    expect(changed.body[0]).toContain("the two lines on Compare with friends on 10 October 2026");
    expect(changed.body[0]).toContain("A line that begins with a date is new on that date.");
    for (const line of changed.list ?? []) if (line.includes("11 October 2026")) expect(line.startsWith("On 11 October 2026")).toBe(true);
    expect(changed.list?.filter((line) => line.startsWith("Compare with friends"))).toHaveLength(2);
    expect(policy).toContain("The bonus does not depend on keeping them on");
    expect(policy).toContain("no bonus is paid while it is.");
    expect(policy).toContain("whether you turn them on with it or one at a time");
    expect(TERMS_VERSION).toBe("2026-10-30"); // bumped for the New stocks email, David said yes on 2026-10-29
  });
});
