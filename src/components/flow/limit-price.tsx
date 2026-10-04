"use client";

import { CalendarBlank, Hourglass } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCopy, useMoney } from "@/components/settings-provider";
import { cn } from "@/lib/utils";
import { parseLimitPrice, priceNumber, type LimitExpiry, type LimitSide } from "@/lib/limit-orders";

/**
 * The limit order's three faces in the order drawers (lib/limit-orders):
 * the price fields beside the amount, the summary the person checks
 * before signing, and the line that says it is waiting. Views only: the
 * drawers own the state and the machine (hooks/use-vault-action) owns the
 * order.
 */

export type OrderMode = "now" | "price";

/** Today as a date input's minimum, in the person's own time. */
function todayInput(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const CHIP =
  "h-8 rounded-full border px-3 text-[13px] outline-none transition-[transform,background-color,color,border-color] duration-150 ease-lift active:scale-[0.97] focus-visible:ring-3 focus-visible:ring-ring/50";

export function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        CHIP,
        selected
          ? "border-foreground/80 bg-foreground text-background"
          : "border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * "Now" or "Set a price" beside the amount; with a price, the price field
 * (starting from today's price) and how long the order waits.
 */
export function LimitPriceFields({
  side,
  mode,
  onMode,
  priceText,
  onPriceText,
  marketLabel,
  expiry,
  onExpiry,
  tokenOk,
  fillsNow,
  throughHint = false,
  noPriceHint = false,
}: {
  side: LimitSide;
  mode: OrderMode;
  onMode: (mode: OrderMode) => void;
  priceText: string;
  onPriceText: (text: string) => void;
  /** Today's price, formatted, when the oracle has one. */
  marketLabel?: string;
  expiry: LimitExpiry;
  onExpiry: (expiry: LimitExpiry) => void;
  /** Whether what pays (or is paid out) can carry a price in v1: a dollar coin on EVM. */
  tokenOk: boolean;
  /** Whether the price is already met at the market. */
  fillsNow: boolean;
  /** Whether the price is too far through the market to be placed (lib/limit-orders throughMarket). */
  throughHint?: boolean;
  /** Whether there is no live price to check the limit against. */
  noPriceHint?: boolean;
}) {
  const copy = useCopy();
  const money = useMoney();
  // The price is typed and kept in dollars, the currency the order fires
  // on; in another display currency a quiet line gives it at the rate.
  const typedPrice = parseLimitPrice(priceText);
  const priceAbout = typedPrice !== undefined ? money.aboutAtRate(priceNumber(typedPrice)) : null;
  return (
    <div className="flex flex-col gap-2.5" data-testid="limit-fields" data-ph-mask>
      <div className="flex gap-1.5" role="group">
        <Chip selected={mode === "now"} onClick={() => onMode("now")}>
          {copy.limitModeNow}
        </Chip>
        <Chip selected={mode === "price"} onClick={() => onMode("price")}>
          {copy.limitModePrice}
        </Chip>
      </div>

      {mode === "price" && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
          <label className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm text-muted-foreground">
              {side === "buy" ? copy.limitBuyAt : copy.limitSellAt}
            </span>
            <span className="flex flex-1 items-baseline gap-0.5">
              <span aria-hidden className={cn("text-xl font-semibold tabular-nums", priceText ? "text-foreground" : "text-muted-foreground/40")}>
                $
              </span>
              <input
                value={priceText}
                onChange={(event) => onPriceText(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="0.00"
                aria-label={copy.limitPriceLabel}
                className="money w-full min-w-0 bg-transparent text-xl font-semibold text-foreground tabular-nums outline-none placeholder:text-muted-foreground/40"
              />
            </span>
            {marketLabel && (
              <span className="money shrink-0 text-xs text-muted-foreground tabular-nums">{copy.limitPriceNow(marketLabel)}</span>
            )}
          </label>
          {priceAbout && (
            <p className="-mt-1.5 pl-[4.25rem] text-xs text-muted-foreground tabular-nums" data-testid="limit-price-about">
              {priceAbout}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <Chip selected={expiry.kind === "never"} onClick={() => onExpiry({ kind: "never" })}>
              {copy.limitUntilCancelled}
            </Chip>
            <Chip
              selected={expiry.kind === "date"}
              onClick={() => expiry.kind !== "date" && onExpiry({ kind: "date", day: "" })}
            >
              {copy.limitUntilDate}
            </Chip>
            {expiry.kind === "date" && (
              <span className="flex items-center gap-1.5">
                <CalendarBlank weight="duotone" className="size-4 text-muted-foreground" aria-hidden />
                <input
                  type="date"
                  min={todayInput()}
                  value={expiry.day}
                  onChange={(event) => onExpiry({ kind: "date", day: event.target.value })}
                  aria-label={copy.limitDateLabel}
                  className="money h-8 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground outline-none focus:border-ring"
                />
              </span>
            )}
          </div>

          {!tokenOk ? (
            <p className="text-xs leading-snug text-muted-foreground">
              {side === "buy" ? copy.limitNeedsDollarsBuy : copy.limitNeedsDollarsSell}
            </p>
          ) : noPriceHint ? (
            <p className="text-xs leading-snug text-muted-foreground">{copy.limitNoPrice}</p>
          ) : throughHint ? (
            <p className="text-xs leading-snug text-destructive">
              {side === "buy" ? copy.limitThroughBuy : copy.limitThroughSell}
            </p>
          ) : fillsNow ? (
            <p className="text-xs leading-snug text-muted-foreground">{copy.limitFillsNow}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The check before signing: what fills when, what leaves now, that it waits in SODAX's contract, the fee. */
export function LimitSummary({
  side,
  name,
  priceLabel,
  priceAbout,
  putLabel,
  getLabel,
  feeLabel,
  noGasChain,
  expiryDay,
  onBack,
  onPlace,
  placeLabel,
  busy,
  held,
}: {
  side: LimitSide;
  name: string;
  priceLabel: string;
  /** The price in the display currency, "about €184.00 at today's rate", or null in dollars. */
  priceAbout?: string | null;
  /** What leaves now: dollars for a buy, shares for a sell. */
  putLabel: string;
  /** The least that comes back: shares for a buy, dollars for a sell. */
  getLabel: string;
  feeLabel?: string;
  /**
   * The chain's name when Privy pays this order's network fee (an email
   * user on a sponsored chain, hooks/use-gas-sponsor); the fee line then
   * says so instead of "plus the network fee".
   */
  noGasChain?: string;
  /** The last day, formatted, or undefined for until cancelled. */
  expiryDay?: string;
  onBack: () => void;
  onPlace: () => void;
  placeLabel: string;
  busy?: boolean;
  /** A sponsored send may still land (lib/gas-sponsor outcome hold): Place stays off. */
  held?: boolean;
}) {
  const copy = useCopy();
  const lines = [
    side === "buy" ? copy.limitSummaryPay(putLabel) : copy.limitSummaryPut(putLabel),
    copy.limitSummaryGet(getLabel),
    copy.limitSummaryLocked,
    expiryDay ? copy.limitSummaryUntilDate(expiryDay) : copy.limitSummaryUntilCancelled,
    copy.limitSummaryWhole,
    ...(feeLabel
      ? [noGasChain ? copy.limitSummaryFeeNoGas(feeLabel, noGasChain) : copy.limitSummaryFee(feeLabel)]
      : noGasChain
        ? [copy.noNetworkFeeOn(noGasChain)]
        : []),
  ];
  return (
    <div className="flex flex-col gap-4" data-testid="limit-summary" data-ph-mask>
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{copy.limitReviewTitle}</span>
        <p className="font-display text-lg leading-snug text-foreground">
          {side === "buy" ? copy.limitSummaryBuy(name, priceLabel) : copy.limitSummarySell(name, priceLabel)}
        </p>
        {priceAbout && <p className="-mt-2 text-xs text-muted-foreground tabular-nums">{priceAbout}</p>}
        <ul className="flex flex-col gap-1.5 text-sm leading-snug text-muted-foreground">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <Button className="h-12 w-full text-base" disabled={busy || held} onClick={onPlace}>
          {busy && <Spinner className="size-4" />}
          {placeLabel}
        </Button>
        <Button variant="ghost" className="h-10 w-full" disabled={busy} onClick={onBack}>
          {copy.limitBack}
        </Button>
      </div>
    </div>
  );
}

/** Placed: the order waits, and where to find it. */
export function LimitPlaced({
  name,
  priceLabel,
  onDone,
  unsaved = false,
}: {
  name: string;
  priceLabel: string;
  onDone: () => void;
  /** The order rests on the hub but Berth has not saved it yet. */
  unsaved?: boolean;
}) {
  const copy = useCopy();
  return (
    <div className="flex flex-col items-center gap-3 px-3 py-4 text-center" data-testid="limit-placed" data-ph-mask>
      <Hourglass weight="duotone" className="size-12 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg text-foreground">{copy.limitPlacedTitle}</p>
        <p className="text-sm text-muted-foreground">{unsaved ? copy.limitUnsaved : copy.limitPlacedBody(name, priceLabel)}</p>
      </div>
      <Button className="h-12 w-full text-base" onClick={onDone}>
        {copy.done}
      </Button>
    </div>
  );
}
