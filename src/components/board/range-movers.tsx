"use client";

import { CompanyMark } from "@/components/company-marks";
import { useCopy, useMoney } from "@/components/settings-provider";
import { LISTING_MARK_BY_SYMBOL } from "@/lib/listings";
import { FEE_PCT_LABEL } from "@/lib/sodax-config";
import { changeDirection, formatPercentChange } from "@/lib/performance";
import { rangeMovers, rangeTrades, type Contribution, type StoryOrder } from "@/lib/portfolio-story";
import { cn } from "@/lib/utils";

const TONE = { up: "text-good", down: "text-bad", flat: "text-muted-foreground" } as const;

/**
 * In place of the week strip on 14D, 30D, 90D and First buy: the holdings
 * that moved the portfolio most over the range (lib/portfolio-story
 * rangeMovers), each by its mark and its name, the dollars it made or lost
 * while held and its return while held (fee on buys included, as a quiet
 * note says). Under
 * it one quiet line naming what was bought and sold in the range. Nothing
 * at all when the range has no movement yet.
 */
export function RangeMovers({
  since,
  contributions,
  changeUsd,
  orders,
  tradesAfter,
  nameOf,
}: {
  /** The range's first day, already in the house format ("Sep 25"). */
  since: string;
  contributions: readonly Contribution[] | undefined;
  /** The range's dollar change; null when a day is unknown, and then nothing is drawn. */
  changeUsd: number | null | undefined;
  orders: readonly StoryOrder[] | undefined;
  /** On a range based at its first close, that day: trades landing on it are not named. */
  tradesAfter: string | null;
  /** A listing's name as a person reads it. */
  nameOf: (symbol: string) => string;
}) {
  const copy = useCopy();
  const money = useMoney();
  const rows = rangeMovers(contributions, changeUsd);
  if (rows.length === 0) return null;
  const trades = rangeTrades(orders, tradesAfter);
  const signed = (usd: number) => `${usd > 0 ? "+" : "−"}${money.format(Math.abs(usd))}`;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="text-xs leading-5 text-muted-foreground">{copy.portfolioMoversLabel(since)}</p>
      {/* Blocked, not masked: the rows are the account's own holdings, with their marks. */}
      <ul data-ph-block className="mt-1.5 flex flex-col">
        {rows.map((row) => {
          const mark = LISTING_MARK_BY_SYMBOL[row.symbol];
          const tone = TONE[changeDirection(row.usd) ?? "flat"];
          const pct = row.pct == null ? null : formatPercentChange(row.pct, 1);
          return (
            <li
              key={row.symbol}
              aria-label={copy.portfolioMoverAria({ name: nameOf(row.symbol), usd: signed(row.usd), pct })}
              className="flex min-h-9 items-center gap-2.5 py-1 text-[13px] leading-5"
            >
              <span
                aria-hidden="true"
                className="money flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-medium tracking-tight text-secondary-foreground"
              >
                {mark ? <CompanyMark id={mark} className="size-3.5" /> : row.symbol.slice(0, 4)}
              </span>
              <span aria-hidden="true" className="min-w-0 flex-1 truncate text-foreground">
                {nameOf(row.symbol)}
              </span>
              <span aria-hidden="true" className={cn("money shrink-0 tabular-nums", tone)}>
                {signed(row.usd)}
              </span>
              <span aria-hidden="true" className="money w-[4.25rem] shrink-0 text-right text-muted-foreground tabular-nums">
                {pct ?? "·"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.portfolioMoversNote(FEE_PCT_LABEL)}</p>
      {trades && (
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          {copy.portfolioRangeTrades({
            bought: trades.bought.map(nameOf),
            moreBought: trades.moreBought,
            sold: trades.sold.map(nameOf),
            moreSold: trades.moreSold,
          })}
        </p>
      )}
    </div>
  );
}
