"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseUnits } from "viem";
import { HoldingsView, type HoldingRow } from "@/components/board";
import { AccountTotalView } from "@/components/board/account-total";
import { Panel } from "@/components/ui/panel";
import type { PortfolioHistoryResponse } from "@/app/api/portfolio/history/route";
import { compareHolding, type Marks, type OrderFacts } from "@/lib/benchmark";
import { BENCHMARKS } from "@/lib/benchmarks";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { markAsOf } from "@/lib/marks";
import {
  explainedFrom,
  ledgerExplains,
  type Holding,
  type SnapshotBase,
} from "@/lib/portfolio-days";
import { historyRanges, type PortfolioDay } from "@/lib/portfolio-history";
import { withStory } from "@/lib/portfolio-story";
import type { MoveNews } from "@/app/api/moves/route";
import { isNewAccount } from "@/components/board/account-total";
import MARKS_JSON from "./portfolio-marks.json";
import { FRIEND_CHOICE_KEY, FRIEND_WEEK_RANGES, friendWindow, returnSeries, type CompareFriend } from "@/lib/friend-week";

/**
 * Dev-only: the account's figure with its comparison, and "What you own",
 * in each of their states, drawn by the real AccountTotalView (with
 * PortfolioSummary) and HoldingsView from seeded query data, so the
 * chart, the headline and the range control can be reviewed (and
 * screenshotted) without an account in that state.
 *
 *   /dev/account?portfolio=three-months   the whole stored stretch, four buys and a sell
 *   /dev/account?portfolio=four-days      a first buy four market days ago
 *   /dev/account?portfolio=large          the same stretch at four-digit dollars
 *   /dev/account?portfolio=value-only     a buy paid in a coin with no price
 *   /dev/account?portfolio=moved          money moved without an order; compared from the next snapshot
 *   /dev/account?portfolio=moved-today    money moved since the last snapshot; nothing to compare yet
 *   /dev/account?portfolio=record-late    bought before the first stored day, and the gap could not be rebuilt
 *   /dev/account?portfolio=first-day      bought today, one point: what was paid to what it is worth
 *   /dev/account?portfolio=day-1          two buys today at the morning's price, valued at the close
 *   /dev/account?portfolio=day-3          a first buy three market days ago and a second since
 *   /dev/account?portfolio=day-7          the first seven market days, full, with news on the last
 *   /dev/account?portfolio=one-month      a month with several buys and a sell
 *   /dev/account?portfolio=down-week      a week in which most days fell
 *   /dev/account?portfolio=narrow         a double-digit day and an unmarked name, for a 320px check
 *   /dev/account?portfolio=empty          nothing held
 *   /dev/account?portfolio=loading        the query still out
 *
 * Add &friend=mara to pick a friend who compares their week (lib/friend-week):
 * her line is drawn from the same real closes, over 1W and First buy.
 *
 * The prices are real: daily closes from the `marks` table (NVIDIA, Apple,
 * Tesla and the five benchmarks, 2026-06-26 to 2026-09-24), saved beside
 * this file. The arithmetic is the server's own (historyRanges), run here on
 * those closes and a made up set of orders. The stored marks begin on
 * 2026-06-26, so a three month range is not yet offered by any account and
 * is not offered here either; the longest stretch is "First buy".
 *
 * As in the rewards gallery, the data is seeded under the signed-out
 * identity (key null); signed in, the real account's history shows instead.
 */

export const PORTFOLIO_STATES = [
  "three-months",
  "large",
  "four-days",
  "value-only",
  "moved",
  "moved-today",
  "record-late",
  "first-day",
  "day-1",
  "day-3",
  "day-7",
  "one-month",
  "down-week",
  "narrow",
  "empty",
  "loading",
] as const;
export type PortfolioState = (typeof PORTFOLIO_STATES)[number];

const MARKS: Record<string, Marks> = {
  ...(MARKS_JSON as Record<string, Marks>),
  // Dev only: Microsoft has no stored closes here and no pinned mark, so
  // the narrow scene borrows Tesla's swings to show a long unmarked name
  // on a double-digit day. Not Microsoft's prices.
  MSFT: (MARKS_JSON as Record<string, Marks>).TSLA,
};
const FEE = 0.003;

/** `priceDay`: the day whose close the buy was filled at, when not its own (a morning buy). */
type Buy = { symbol: string; day: string; usd: number; unpriced?: boolean; priceDay?: string };
type Sell = { symbol: string; day: string; share: number };
/** A share of a holding that left the account without an order. */
type Moved = { symbol: string; day: string; share: number };
type Scene = {
  from: string;
  /** The last day drawn; the stored closes' last day when absent. */
  to?: string;
  /** A large move with news on the last day (a made up post; dev only). */
  move?: { symbol: string; author: string };
  buys: Buy[];
  sells: Sell[];
  moved?: Moved[];
  /** Money moved after the newest snapshot, seen only in today's balances. */
  movedToday?: boolean;
  /** No day before this one is stored: the record starts after the first buy. */
  recordFrom?: string;
};

/** Dev only: made up friends who compare their week, and the orders behind mara's line. */
const COMPARE_FRIENDS: CompareFriend[] = [
  { handle: "mara", avatarId: "ring", level: 4 },
  { handle: "quay_side", avatarId: "lantern", level: 2 },
];
const FRIEND_SCENE: Scene = {
  from: "2026-08-12",
  buys: [
    { symbol: "TSLA", day: "2026-08-12", usd: 50 },
    { symbol: "AAPL", day: "2026-09-08", usd: 30 },
  ],
  sells: [],
};

const SCENES: Record<Exclude<PortfolioState, "empty" | "loading">, Scene> = {
  "three-months": {
    from: "2026-07-01",
    buys: [
      { symbol: "NVDA", day: "2026-07-01", usd: 40 },
      { symbol: "AAPL", day: "2026-07-15", usd: 25 },
      { symbol: "TSLA", day: "2026-08-05", usd: 20 },
      { symbol: "NVDA", day: "2026-08-20", usd: 15 },
    ],
    sells: [{ symbol: "AAPL", day: "2026-09-02", share: 0.5 }],
  },
  large: {
    from: "2026-07-01",
    buys: [
      { symbol: "NVDA", day: "2026-07-01", usd: 510 },
      { symbol: "AAPL", day: "2026-07-15", usd: 320 },
      { symbol: "TSLA", day: "2026-08-05", usd: 255 },
      { symbol: "NVDA", day: "2026-08-20", usd: 190 },
    ],
    sells: [{ symbol: "AAPL", day: "2026-09-02", share: 0.5 }],
  },
  "four-days": {
    from: "2026-09-18",
    buys: [
      { symbol: "NVDA", day: "2026-09-18", usd: 12 },
      { symbol: "TSLA", day: "2026-09-18", usd: 8 },
    ],
    sells: [],
  },
  "value-only": {
    from: "2026-09-10",
    buys: [
      { symbol: "NVDA", day: "2026-09-10", usd: 30, unpriced: true },
      { symbol: "AAPL", day: "2026-09-15", usd: 10 },
    ],
    sells: [],
  },
  moved: {
    from: "2026-09-10",
    buys: [
      { symbol: "NVDA", day: "2026-09-10", usd: 12 },
      { symbol: "TSLA", day: "2026-09-10", usd: 8 },
      { symbol: "AAPL", day: "2026-09-18", usd: 6 },
    ],
    sells: [],
    moved: [{ symbol: "TSLA", day: "2026-09-16", share: 0.6 }],
  },
  "moved-today": {
    from: "2026-09-10",
    buys: [
      { symbol: "NVDA", day: "2026-09-10", usd: 12 },
      { symbol: "TSLA", day: "2026-09-10", usd: 8 },
    ],
    sells: [],
    movedToday: true,
  },
  "record-late": {
    from: "2026-09-10",
    buys: [
      { symbol: "NVDA", day: "2026-09-10", usd: 12 },
      { symbol: "TSLA", day: "2026-09-10", usd: 8 },
    ],
    sells: [],
    recordFrom: "2026-09-17",
  },
  "first-day": {
    from: "2026-09-24",
    buys: [{ symbol: "AAPL", day: "2026-09-24", usd: 15 }],
    sells: [],
  },
  "day-1": {
    from: "2026-09-24",
    buys: [
      { symbol: "NVDA", day: "2026-09-24", usd: 15, priceDay: "2026-09-23" },
      { symbol: "TSLA", day: "2026-09-24", usd: 10, priceDay: "2026-09-23" },
    ],
    sells: [],
  },
  "day-3": {
    from: "2026-09-22",
    buys: [
      { symbol: "NVDA", day: "2026-09-22", usd: 20, priceDay: "2026-09-21" },
      { symbol: "AAPL", day: "2026-09-23", usd: 10 },
    ],
    sells: [],
  },
  "day-7": {
    from: "2026-09-16",
    buys: [
      { symbol: "NVDA", day: "2026-09-16", usd: 25 },
      { symbol: "TSLA", day: "2026-09-16", usd: 15 },
      { symbol: "AAPL", day: "2026-09-21", usd: 10 },
    ],
    sells: [],
    move: { symbol: "NVDA", author: "Harbour Wire" },
  },
  "one-month": {
    from: "2026-08-25",
    buys: [
      { symbol: "NVDA", day: "2026-08-25", usd: 30 },
      { symbol: "AAPL", day: "2026-09-02", usd: 15 },
      { symbol: "TSLA", day: "2026-09-10", usd: 12 },
      { symbol: "NVDA", day: "2026-09-17", usd: 10 },
    ],
    sells: [{ symbol: "AAPL", day: "2026-09-21", share: 0.4 }],
  },
  narrow: {
    from: "2026-06-26",
    to: "2026-07-08",
    buys: [
      { symbol: "MSFT", day: "2026-06-26", usd: 20 },
      { symbol: "NVDA", day: "2026-06-26", usd: 5 },
    ],
    sells: [],
  },
  "down-week": {
    from: "2026-09-02",
    to: "2026-09-15",
    buys: [
      { symbol: "NVDA", day: "2026-09-02", usd: 30 },
      { symbol: "TSLA", day: "2026-09-02", usd: 8 },
    ],
    sells: [],
  },
};

function closeOnOrBefore(marks: Marks, day: string): number {
  let found = marks.values[0];
  for (let index = 0; index < marks.dates.length && marks.dates[index] <= day; index += 1) {
    found = marks.values[index];
  }
  return found;
}

/** Orders, stored days and rows for a scene, from the real closes. */
function build(scene: Scene) {
  const placed = (day: string) => `${day}T15:00:00.000Z`;
  const orders: OrderFacts[] = [];
  const events = [
    ...scene.buys.map((buy) => ({ kind: "buy" as const, ...buy })),
    ...scene.sells.map((sell) => ({ kind: "sell" as const, ...sell })),
    ...(scene.moved ?? []).map((moved) => ({ kind: "moved" as const, ...moved })),
  ].sort((a, b) => a.day.localeCompare(b.day));

  const held = new Map<string, number>();
  const calendar = MARKS.NVDA.dates.filter((day) => day >= scene.from && (!scene.to || day <= scene.to));
  const days: (PortfolioDay & SnapshotBase & { source: "snapshot" })[] = [];
  let next = 0;
  for (const day of calendar) {
    for (; next < events.length && events[next].day <= day; next += 1) {
      const event = events[next];
      const price = closeOnOrBefore(
        MARKS[event.symbol],
        event.kind === "buy" && event.priceDay ? event.priceDay : event.day,
      );
      if (event.kind === "buy") {
        const quantity = (event.usd * (1 - FEE)) / price;
        held.set(event.symbol, (held.get(event.symbol) ?? 0) + quantity);
        orders.push({
          symbol: event.symbol,
          direction: "buy",
          quantity,
          usd: event.unpriced ? null : event.usd,
          placedAt: placed(event.day),
          // What each benchmark stood at when the buy was placed, as the
          // server stores it per order (order_marks); here, that day's close.
          benchmarkMarks: Object.fromEntries(
            BENCHMARKS.map(({ symbol }) => [symbol, closeOnOrBefore(MARKS[symbol], event.day)]),
          ),
        });
      } else if (event.kind === "moved") {
        held.set(event.symbol, (held.get(event.symbol) ?? 0) * (1 - event.share));
      } else {
        const quantity = (held.get(event.symbol) ?? 0) * event.share;
        held.set(event.symbol, (held.get(event.symbol) ?? 0) - quantity);
        orders.push({
          symbol: event.symbol,
          direction: "sell",
          quantity,
          usd: quantity * price,
          placedAt: placed(event.day),
        });
      }
    }
    const holdings: Holding[] = [...held]
      .filter(([, quantity]) => quantity > 0)
      .map(([symbol, quantity]) => ({
        symbol,
        quantity,
        price: closeOnOrBefore(MARKS[symbol], day),
        source: "mark",
      }));
    const value = holdings.reduce((sum, holding) => sum + holding.quantity * holding.price, 0);
    days.push({ day, value, asOf: markAsOf(day), holdings, source: "snapshot" });
  }

  const last = calendar.at(-1)!;
  const spyNow = closeOnOrBefore(MARKS.SPY, last);
  const rows: HoldingRow[] = [...held]
    .filter(([, quantity]) => quantity > 0)
    .map(([symbol, quantity]) => {
      const listing = TOKEN_LISTINGS.find((candidate) => candidate.symbol === symbol)!;
      const priceNow = closeOnOrBefore(MARKS[symbol], last);
      return {
        listing,
        balance: parseUnits(quantity.toFixed(Math.min(listing.decimals, 12)), listing.decimals),
        worth: quantity * priceNow,
        comparison: compareHolding({
          orders: orders.filter((order) => order.symbol === symbol),
          held: quantity,
          priceNow,
          benchmarkNow: spyNow,
          benchmarkMarks: MARKS.SPY,
        }),
      };
    });
  const stored = scene.recordFrom ? days.filter((entry) => entry.day >= scene.recordFrom!) : days;
  return { orders, days: stored, rows };
}

export function seededPortfolioClient(
  state: PortfolioState,
  { xp }: { xp?: number } = {},
): { client: QueryClient; rows: HoldingRow[]; young: boolean } {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  // A profile, for a gallery that draws the header's rank chip.
  if (xp !== undefined) {
    client.setQueryData(["profile", null], { xp, avatarId: null, hasEmail: true, referralCode: null });
  }
  if (state === "empty" || state === "loading") {
    const rows = state === "loading" ? build(SCENES["four-days"]).rows : [];
    return { client, rows, young: false };
  }
  const scene = SCENES[state];
  const { orders, days, rows } = build(scene);
  // As the server judges it (lib/server/portfolio-view), on the newest
  // snapshot; a move after it is only in today's balances.
  const newest = days.at(-1)!;
  const balanceExplained =
    !scene.movedToday &&
    ledgerExplains(
      orders,
      Object.fromEntries(newest.holdings.map((holding) => [holding.symbol, holding.quantity])),
    );
  const base =
    balanceExplained || scene.movedToday ? undefined : explainedFrom(days, orders, undefined);
  for (const benchmark of BENCHMARKS) {
    const { ranges, available } = historyRanges({
      days,
      orders,
      benchmarkSymbol: benchmark.symbol,
      benchmarkMarks: MARKS[benchmark.symbol],
      listingCloses: MARKS,
      balanceExplained,
      base,
    });
    const response: PortfolioHistoryResponse = {
      benchmark: { symbol: benchmark.symbol, name: benchmark.name },
      benchmarks: BENCHMARKS.map(({ symbol, name }) => ({ symbol, name })),
      // Each day's story, as the server adds it (lib/server/portfolio-view).
      ranges: withStory(ranges, { days, orders, listingCloses: MARKS }, { rebased: Boolean(base) }),
      available,
      updatedAt: `${days.at(-1)!.day}T21:30:00.000Z`,
      todaySource: null,
    };
    client.setQueryData(["portfolio-history", null, benchmark.symbol], response);
  }
  // Compare with friends, seeded as the social route answers them: mara's
  // line over each window the card can show, from her own made up orders.
  client.setQueryData(["social-me", null], {
    hasEmail: true,
    handle: "harbourfan",
    visible: true,
    linkFace: false,
    shareHoldings: false,
    shareWeek: true,
    nextChangeAt: null,
    requests: 0,
  });
  client.setQueryData(["social-compare-friends", null], COMPARE_FRIENDS);
  const friend = build({ ...FRIEND_SCENE, to: scene.to });
  const series = returnSeries({ days: friend.days, orders: friend.orders, listingCloses: MARKS });
  const anyRanges = (client.getQueryData(["portfolio-history", null, BENCHMARKS[0].symbol]) as PortfolioHistoryResponse).ranges;
  for (const range of FRIEND_WEEK_RANGES) {
    const from = anyRanges[range]?.days[0]?.day;
    if (from) client.setQueryData(["social-compare-week", null, "mara", range, from], friendWindow(series, from));
  }
  // The board's moves (/api/moves), seeded: a made up post on the scene's last day.
  client.setQueryData(["listings", "moves"], scene.move ? [sceneMove(scene.move, newest.day)] : []);
  // As the board judges it (AccountTotal), with the scene's last day as now.
  const young = isNewAccount(orders, Date.parse(markAsOf(newest.day)));
  return { client, rows, young };
}

/** A made up post beside the day's real move, to lay out the news line. Dev only. */
function sceneMove(move: NonNullable<Scene["move"]>, day: string): MoveNews {
  const marks = MARKS[move.symbol];
  const at = marks.dates.indexOf(day);
  const changePct = at > 0 ? (marks.values[at] / marks.values[at - 1] - 1) * 100 : 0;
  return {
    asOf: day,
    symbol: move.symbol,
    changePct,
    post: {
      url: "https://x.com/berthmarkets",
      name: move.author,
      username: "berthmarkets",
      publishedAt: Date.parse(`${day}T14:00:00Z`),
      text: "A made up post, for the gallery only.",
    },
  };
}

export function PortfolioGallery({ state, friend }: { state: PortfolioState; friend?: string | null }) {
  const [{ client, rows, young }] = useState(() => {
    // The friend picked, as the card keeps it (PortfolioSummary FRIEND_KEY): set before it first reads.
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(FRIEND_CHOICE_KEY, friend ?? "");
      } catch {
        // Storage blocked: the card shows the benchmark.
      }
    }
    return seededPortfolioClient(state);
  });
  const total = rows.reduce((sum, row) => sum + (row.worth ?? 0), 0);
  return (
    <QueryClientProvider client={client}>
      <div className="flex flex-col gap-3">
        <nav className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {PORTFOLIO_STATES.map((name) => (
            <a
              key={name}
              href={`?portfolio=${name}`}
              className={name === state ? "text-foreground underline" : "hover:text-foreground"}
            >
              {name}
            </a>
          ))}
        </nav>
        <AccountTotalView
          figures={{
            holdings: state === "loading" ? undefined : total,
            cash: 0,
            funds: 0,
            holdsAnything: state !== "empty",
          }}
          compareOpenByDefault={young}
        />
        <Panel>
          <HoldingsView
            rows={rows}
            loading={false}
            pricesLoading={false}
            total={state === "loading" ? undefined : total}
            includesCash={false}
            onSell={() => {}}
          />
        </Panel>
      </div>
    </QueryClientProvider>
  );
}
