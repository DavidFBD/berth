"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseUnits } from "viem";
import { HoldingsView, type HoldingRow } from "@/components/board";
import { Panel } from "@/components/ui/panel";
import type { PortfolioHistoryResponse } from "@/app/api/portfolio/history/route";
import { compareHolding, type Marks, type OrderFacts } from "@/lib/benchmark";
import { BENCHMARKS } from "@/lib/benchmarks";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { historyRanges, type PortfolioDay } from "@/lib/portfolio-history";
import MARKS_JSON from "./portfolio-marks.json";

/**
 * Dev-only: the top of "What you own" in each of its states, drawn by the
 * real HoldingsView and PortfolioSummary from seeded query data, so the
 * chart, the headline and the range control can be reviewed (and
 * screenshotted) without an account in that state.
 *
 *   /dev/account?portfolio=three-months   the whole stored stretch, four buys and a sell
 *   /dev/account?portfolio=four-days      a first buy four market days ago
 *   /dev/account?portfolio=value-only     a buy paid in a coin with no price
 *   /dev/account?portfolio=first-day      bought today, nothing to draw yet
 *   /dev/account?portfolio=empty          nothing held
 *   /dev/account?portfolio=loading        the query still out
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
  "four-days",
  "value-only",
  "first-day",
  "empty",
  "loading",
] as const;
export type PortfolioState = (typeof PORTFOLIO_STATES)[number];

const MARKS = MARKS_JSON as Record<string, Marks>;
const FEE = 0.003;

type Buy = { symbol: string; day: string; usd: number; unpriced?: boolean };
type Sell = { symbol: string; day: string; share: number };
type Scene = { from: string; buys: Buy[]; sells: Sell[] };

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
  "first-day": {
    from: "2026-09-24",
    buys: [{ symbol: "AAPL", day: "2026-09-24", usd: 15 }],
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
  ].sort((a, b) => a.day.localeCompare(b.day));

  const held = new Map<string, number>();
  const calendar = MARKS.NVDA.dates.filter((day) => day >= scene.from);
  const days: PortfolioDay[] = [];
  let next = 0;
  for (const day of calendar) {
    for (; next < events.length && events[next].day <= day; next += 1) {
      const event = events[next];
      const price = closeOnOrBefore(MARKS[event.symbol], event.day);
      if (event.kind === "buy") {
        const quantity = (event.usd * (1 - FEE)) / price;
        held.set(event.symbol, (held.get(event.symbol) ?? 0) + quantity);
        orders.push({
          symbol: event.symbol,
          direction: "buy",
          quantity,
          usd: event.unpriced ? null : event.usd,
          placedAt: placed(event.day),
        });
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
    const value = [...held].reduce(
      (sum, [symbol, quantity]) => sum + quantity * closeOnOrBefore(MARKS[symbol], day),
      0,
    );
    days.push({ day, value });
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
  return { orders, days, rows };
}

function seededClient(state: PortfolioState): { client: QueryClient; rows: HoldingRow[] } {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  if (state === "empty" || state === "loading") {
    const rows = state === "loading" ? build(SCENES["four-days"]).rows : [];
    return { client, rows };
  }
  const { orders, days, rows } = build(SCENES[state]);
  for (const benchmark of BENCHMARKS) {
    const { ranges, available } = historyRanges({
      days,
      orders,
      benchmarkMarks: MARKS[benchmark.symbol],
      listingCloses: MARKS,
    });
    const response: PortfolioHistoryResponse = {
      benchmark: { symbol: benchmark.symbol, name: benchmark.name },
      benchmarks: BENCHMARKS.map(({ symbol, name }) => ({ symbol, name })),
      ranges,
      available,
      updatedAt: `${days.at(-1)!.day}T21:30:00.000Z`,
      todaySource: null,
    };
    client.setQueryData(["portfolio-history", null, benchmark.symbol], response);
  }
  return { client, rows };
}

export function PortfolioGallery({ state }: { state: PortfolioState }) {
  const [{ client, rows }] = useState(() => seededClient(state));
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
        <Panel className="divide-y divide-border">
          <HoldingsView
            rows={rows}
            loading={false}
            pricesLoading={false}
            total={state === "loading" ? undefined : total}
            onSell={() => {}}
          />
        </Panel>
      </div>
    </QueryClientProvider>
  );
}
