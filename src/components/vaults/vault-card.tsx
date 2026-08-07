"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { type LeverageYieldVault } from "@sodax/dapp-kit";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CupArt, SteamPlume } from "@/components/tea/tea-art";
import { SILK_CUP } from "@/components/tea/silk";
import { TokenLogo } from "@/components/flow/token-picker";
import { useCupView } from "@/hooks/use-cup-view";
import { useTickingValue } from "@/hooks/use-ticking-value";
import { useCopy, useMoney } from "@/components/settings-provider";
import { formatRayAsPercent, formatTokenAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getVaultMeta } from "@/lib/vaults-meta";

function Row({
  label,
  value,
  negative,
  strong,
}: {
  label: string;
  value: string | null;
  negative?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between py-0.5 text-[12.5px]",
        strong && "font-bold",
      )}
    >
      <span>{label}</span>
      {value !== null && (
        <span className={cn("money", negative && "text-destructive")}>
          {value}
        </span>
      )}
    </div>
  );
}

/**
 * An earned figure: a settled head at quotable precision, then two quieter
 * digits of real extra precision. Same size, same font — only the ink fades,
 * so it reads as one number rather than a typo. The digits tick because the
 * value does; the "alive" cue is the dot beside the label, never the text.
 * Falls back to a plain token amount when there's no price to speak in.
 */
function EarnedFigure({
  value,
  symbol,
  color,
  split,
}: {
  value: number;
  /** Set only when unpriced — then the figure is in token units. */
  symbol?: string;
  color: string;
  /** Money splitter from useMoney, so the figure prints in the user's currency. */
  split: (usd: number) => { head: string; tail: string };
}) {
  if (symbol) {
    return (
      <span className="money" style={{ color }}>
        {value.toFixed(6)} {symbol}
      </span>
    );
  }

  const { head, tail } = split(value);
  const signed = value > 0 ? `+${head}` : head;

  return (
    <span className="money" style={{ color }}>
      {signed}
      {tail && <span className="opacity-45">{tail}</span>}
    </span>
  );
}

/**
 * The cup card (design system CupCard) — one vault, one cup of tea. Steam
 * intensity scales with how much is steeping; iridescence is reserved for
 * the fullest cups and the post-pour bloom.
 */
export function VaultCard({
  vault,
  onDeposit,
  onWithdraw,
  bloom = false,
}: {
  vault: LeverageYieldVault;
  onDeposit: (v: LeverageYieldVault) => void;
  onWithdraw: (v: LeverageYieldVault) => void;
  /** One-shot iridescent burst above the cup after a successful pour. */
  bloom?: boolean;
}) {
  const meta = getVaultMeta(vault.name);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const copy = useCopy();
  const money = useMoney();

  const accent = `var(--cup-${meta.cupKey})`;
  const deep = `var(--cup-${meta.cupKey}-deep)`;
  const soft = `var(--cup-${meta.cupKey}-soft)`;

  // Steam, fill, and every figure come from the shared cup view, so the card
  // can never disagree with the shelf miniature about the same position. The
  // "≈" and future-tense label carry the "projected, not promised" honesty.
  const cup = useCupView(vault);
  const {
    hasTea,
    priced,
    steepingUsd,
    apr,
    isAprLoading,
    aprNegative,
    yearTotal,
    yearTotalUsd,
    sawtoothSuppressed,
  } = cup;

  const earnedTicking = useTickingValue(
    cup.earnedDisplay,
    cup.earnedPerYear,
    hasTea && cup.earnedDisplay !== undefined && !sawtoothSuppressed,
  );
  const earnedColor =
    !sawtoothSuppressed && earnedTicking !== undefined && earnedTicking < 0
      ? "var(--destructive)"
      : deep;
  // A position we only met after it was funded has an unknowable entry price,
  // so the figure is growth since we started watching — say so rather than
  // pass it off as lifetime earnings.
  const earnedLabel = cup.earnedExact
    ? copy.earnedSoFar
    : copy.earnedSince(
        cup.earnedSince?.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }) ?? "",
      );

  return (
    <div
      className="rounded-2xl border bg-card p-4"
      style={{
        borderColor: `color-mix(in oklch, ${accent} 25%, var(--border))`,
        boxShadow: "var(--shadow-card, var(--shadow-cup))",
      }}
    >
      <div className="flex gap-3.5">
        {/* The cup, steaming to scale */}
        <div className="flex w-21 shrink-0 flex-col items-center">
          <SteamPlume
            level={cup.steamLevel}
            bloom={bloom}
            width={70}
            height={44}
          />
          <CupArt
            accent={accent}
            deep={deep}
            fill={cup.fill}
            bowl={meta.cupKey === "sencha"}
            size={78}
            silk={SILK_CUP[meta.cupKey]}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-display text-[19px] text-foreground">
              {meta.teaName}
            </span>
            {/* Flavour badge and asset line, merged: the logo carries the
                asset, so one pill says what this is without a second line.
                An unknown vault has no symbol — the pill is then flavour only. */}
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full py-0.5 text-[11px] font-bold",
                meta.underlyingSymbol ? "pr-2 pl-0.5" : "px-2",
              )}
              style={{ color: deep, background: soft }}
            >
              {meta.underlyingSymbol && (
                <>
                  <TokenLogo symbol={meta.underlyingSymbol} size={16} />
                  {meta.underlyingSymbol}
                </>
              )}
              <span className={cn(meta.underlyingSymbol && "opacity-55")}>
                {meta.flavour}
              </span>
            </span>
          </div>

          {/* A full cup leads with what it is worth; an empty one has no
              dollars worth saying, so the rate stays the headline there. */}
          {hasTea ? (
            <>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
                <span
                  className="money text-[32px] leading-none font-semibold"
                  style={{ color: deep }}
                >
                  {steepingUsd !== undefined
                    ? money.format(steepingUsd)
                    : `${formatTokenAmount(cup.underlyingValue ?? 0n, 18)} ${meta.underlyingSymbol}`}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {copy.inThePot}
                </span>
              </div>

              {/* Stat blocks, label over value: a long label ("Pin money
                  since Aug 6") wraps inside its own column instead of
                  shearing the date off, and the values sit on one steady
                  baseline instead of a ragged right edge. */}
              {/* Each stat is a column with the label given the slack, so
                  when one mode's label wraps to two lines and the other's
                  doesn't, the two values still share a baseline. */}
              <div className="mt-3 flex items-stretch gap-4">
                {earnedTicking !== undefined && (
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex flex-1 items-center gap-1.5 text-[10.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
                      <span
                        className="live-dot shrink-0"
                        style={{ background: earnedColor }}
                      />
                      <span className="min-w-0">{earnedLabel}</span>
                    </div>
                    <div className="mt-1 text-[15px] font-bold">
                      {sawtoothSuppressed ? (
                        // Flat zero, quiet ink, no tick: interpolating up
                        // from a negative base would cross zero and then
                        // flicker back on every fresh chain read.
                        <span className="money text-muted-foreground">
                          {priced
                            ? money.format(0)
                            : `0.000000 ${meta.underlyingSymbol}`}
                        </span>
                      ) : (
                        <EarnedFigure
                          value={earnedTicking}
                          symbol={priced ? undefined : meta.underlyingSymbol}
                          color={earnedColor}
                          split={money.split}
                        />
                      )}
                    </div>
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex-1 text-[10.5px] font-bold tracking-(--tracking-caps) uppercase text-muted-foreground">
                    {copy.yearOfSteeping}
                  </div>
                  <div className="money mt-1 text-[15px] text-foreground">
                    {yearTotalUsd !== undefined
                      ? `≈ ${money.format(yearTotalUsd)}`
                      : `≈ ${yearTotal.toFixed(4)} ${meta.underlyingSymbol}`}
                  </div>
                </div>
              </div>
            </>
          ) : isAprLoading || apr === undefined ? (
            <Skeleton className="mt-2 h-9 w-32" />
          ) : (
            <>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span
                  className="money text-3xl font-semibold"
                  style={{ color: aprNegative ? "var(--destructive)" : deep }}
                >
                  {formatRayAsPercent(apr.effectiveNetAprRay)}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {copy.perYear}
                  {apr.lsdApr.stale ? " (est.)" : ""}
                </span>
              </div>
              <p className="mt-2 text-[13px] text-muted-foreground">
                {copy.awaitsFirstPour}
              </p>
            </>
          )}
        </div>
      </div>

      {/* CTAs */}
      <div className="mt-3.5 flex gap-2">
        <Button
          className="h-11 flex-1 rounded-full text-[15px] font-bold"
          style={{ background: deep, color: "oklch(0.985 0.008 90)" }}
          onClick={() => onDeposit(vault)}
        >
          {hasTea ? copy.pour : copy.pourFirst}
        </Button>
        {hasTea && (
          <Button
            variant="secondary"
            className="h-11 rounded-full text-[15px] font-bold"
            onClick={() => onWithdraw(vault)}
          >
            {copy.pourBack}
          </Button>
        )}
      </div>

      {/* How strong is this brew? */}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setBreakdownOpen((open) => !open)}
          aria-expanded={breakdownOpen}
          className="flex min-h-8 items-center gap-1.5 py-1 text-[12.5px] font-bold text-muted-foreground transition-colors hover:text-foreground"
        >
          {breakdownOpen ? (
            <CaretUp className="size-3.5" />
          ) : (
            <CaretDown className="size-3.5" />
          )}
          {/* One clause, not two. A full cup shows just the rate (the
              headline it gave up to the dollars); an empty cup keeps the
              question, where it's the invitation. */}
          {hasTea && apr !== undefined ? (
            <span style={{ color: aprNegative ? "var(--destructive)" : deep }}>
              {formatRayAsPercent(apr.effectiveNetAprRay)} {copy.perYear}
              {apr.lsdApr.stale ? " (est.)" : ""}
            </span>
          ) : (
            copy.brewQuestion
          )}
        </button>
        <AnimatePresence initial={false}>
        {breakdownOpen && (
          <motion.div
            key="breakdown"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="overflow-hidden"
          >
          {apr === undefined ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <div
              className="rounded-xl px-3 py-2.5 text-foreground"
              style={{ background: soft }}
            >
              <Row
                label={`${copy.stakingYield} · ${apr.lsdApr.label}`}
                value={`+${formatRayAsPercent(apr.lsdApr.aprRay)}`}
              />
              <Row
                label={copy.lendingSpread}
                value={`+${formatRayAsPercent(apr.supplyAprRay)}`}
              />
              <Row
                label={copy.borrowCost}
                value={`−${formatRayAsPercent(apr.borrowAprRay)}`}
                negative
              />
              <Row
                label={`${copy.leverage} · ${(Number(apr.leverageMultiplierWad / 10n ** 15n) / 1000).toFixed(1)}×`}
                value={null}
              />
              <div
                className="my-1.5 border-t border-dashed"
                style={{
                  borderColor: `color-mix(in oklch, ${deep} 30%, transparent)`,
                }}
              />
              <Row
                label={copy.brewStrength}
                value={formatRayAsPercent(apr.effectiveNetAprRay)}
                strong
              />
              {apr.lsdApr.stale && (
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                  {copy.staleFeedNote}
                </p>
              )}
            </div>
          )}
          </motion.div>
        )}
        </AnimatePresence>
      </div>
    </div>
  );
}
