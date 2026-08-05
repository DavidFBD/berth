"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { AnimatePresence, motion } from "motion/react";

import {
  useLeverageYieldEffectiveApr,
  type LeverageYieldVault,
} from "@sodax/dapp-kit";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CupArt, SteamPlume } from "@/components/tea/tea-art";
import { SILK_CUP } from "@/components/tea/silk";
import { TokenLogo } from "@/components/flow/token-picker";
import { useUserVaultPosition } from "@/hooks/use-user-vault-position";
import { useUsdPrices } from "@/hooks/use-usd-prices";
import { formatRayAsPercent, formatTokenAmount, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getVaultMeta, USD_STEAM_BANDS } from "@/lib/vaults-meta";

/** RAY (1e27) rate → percent number for arithmetic (projection line). */
function rayToPercent(ray: bigint): number {
  return Number((ray * 10_000n) / 10n ** 25n) / 10_000;
}

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

  const accent = `var(--cup-${meta.cupKey})`;
  const deep = `var(--cup-${meta.cupKey}-deep)`;
  const soft = `var(--cup-${meta.cupKey}-soft)`;

  const { data: apr, isLoading: isAprLoading } = useLeverageYieldEffectiveApr({
    params: { vault: vault.vault },
  });
  const position = useUserVaultPosition(vault.vault);
  const prices = useUsdPrices();

  const steeping =
    position.underlyingValue !== undefined
      ? Number(formatUnits(position.underlyingValue, 18))
      : 0;
  const hasTea = position.hasPosition;

  // The position is denominated in the vault's hub asset (the sodaX wrapper),
  // which is a money market reserve — so the oracle already prices it and the
  // card can speak dollars. Token units remain the fallback.
  const price = prices.priceOfHubAsset(vault.asset);
  const steepingUsd = price !== undefined ? steeping * price : undefined;

  // Heat by worth when priced, by token units otherwise.
  const heat = steepingUsd ?? steeping;
  const [t1, t2, t3] =
    steepingUsd !== undefined ? USD_STEAM_BANDS : meta.steamThresholds;
  const steamLevel = !hasTea
    ? 0
    : heat >= t3
      ? 4
      : heat >= t2
        ? 3
        : heat >= t1
          ? 2
          : 1;
  const fill = !hasTea ? 0 : Math.min(1, 0.25 + (heat / t3) * 0.75);

  const aprNegative = apr !== undefined && apr.effectiveNetAprRay < 0n;
  const aprPct = apr !== undefined ? rayToPercent(apr.effectiveNetAprRay) : 0;
  const projection = steeping * (aprPct / 100);
  const projectionUsd = price !== undefined ? projection * price : undefined;

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
          <SteamPlume level={steamLevel} bloom={bloom} width={70} height={44} />
          <CupArt
            accent={accent}
            deep={deep}
            fill={fill}
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

          {isAprLoading || apr === undefined ? (
            <Skeleton className="mt-2 h-9 w-32" />
          ) : (
            <div className="mt-2 flex items-baseline gap-1.5">
              <span
                className="money text-3xl font-semibold"
                style={{ color: aprNegative ? "var(--destructive)" : deep }}
              >
                {formatRayAsPercent(apr.effectiveNetAprRay)}
              </span>
              <span className="text-[13px] text-muted-foreground">
                per year{apr.lsdApr.stale ? " (est.)" : ""}
              </span>
            </div>
          )}

          {hasTea ? (
            <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 text-[13px] text-muted-foreground">
              <span>Steeping</span>
              <span className="money text-right text-foreground">
                {steepingUsd !== undefined
                  ? formatUsd(steepingUsd)
                  : `${formatTokenAmount(position.underlyingValue ?? 0n, 18)} ${meta.underlyingSymbol}`}
              </span>
              <span>A year of steeping</span>
              <span className="money text-right text-foreground">
                {projectionUsd !== undefined
                  ? `≈ ${formatUsd(projectionUsd)}`
                  : `≈ ${projection.toFixed(4)} ${meta.underlyingSymbol}`}
              </span>
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-muted-foreground">
              Your cup awaits its first pour.
            </p>
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
          {hasTea ? "Pour" : "Pour your first cup"}
        </Button>
        {hasTea && (
          <Button
            variant="secondary"
            className="h-11 rounded-full text-[15px] font-bold"
            onClick={() => onWithdraw(vault)}
          >
            Pour back
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
          How strong is this brew?
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
                label={`Staking yield · ${apr.lsdApr.label}`}
                value={`+${formatRayAsPercent(apr.lsdApr.aprRay)}`}
              />
              <Row
                label="Lending spread"
                value={`+${formatRayAsPercent(apr.supplyAprRay)}`}
              />
              <Row
                label="Borrow cost"
                value={`−${formatRayAsPercent(apr.borrowAprRay)}`}
                negative
              />
              <Row
                label={`Leverage · ${(Number(apr.leverageMultiplierWad / 10n ** 15n) / 1000).toFixed(1)}×`}
                value={null}
              />
              <div
                className="my-1.5 border-t border-dashed"
                style={{
                  borderColor: `color-mix(in oklch, ${deep} 30%, transparent)`,
                }}
              />
              <Row
                label="Brew strength"
                value={formatRayAsPercent(apr.effectiveNetAprRay)}
                strong
              />
              {apr.lsdApr.stale && (
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                  The staking number is an estimate right now; the live feed
                  is having a lie-down.
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
