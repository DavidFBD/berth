"use client";

import { useState } from "react";

import {
  useLeverageYieldEffectiveApr,
  useLeverageYieldTotalAssets,
  type LeverageYieldVault,
} from "@sodax/dapp-kit";
import { CaretDown } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserVaultPosition } from "@/hooks/use-user-vault-position";
import {
  formatBps,
  formatRayAsPercent,
  formatTokenAmount,
  formatWadAsMultiplier,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { getVaultMeta } from "@/lib/vaults-meta";

function BreakdownRow({
  label,
  sublabel,
  value,
  negative,
  muted,
}: {
  label: string;
  sublabel?: string;
  value: string;
  negative?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <span className={cn("text-sm", muted && "text-muted-foreground")}>
          {label}
        </span>
        {sublabel ? (
          <span className="ml-1.5 text-xs text-muted-foreground">
            {sublabel}
          </span>
        ) : null}
      </div>
      <span
        className={cn(
          "shrink-0 text-sm font-medium tabular-nums",
          negative && "text-red-600 dark:text-red-400",
          muted && "font-normal text-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function VaultCard({
  vault,
  onDeposit,
  onWithdraw,
}: {
  vault: LeverageYieldVault;
  onDeposit: (v: LeverageYieldVault) => void;
  onWithdraw: (v: LeverageYieldVault) => void;
}) {
  const meta = getVaultMeta(vault.name);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const { data: apr, isLoading: isAprLoading } = useLeverageYieldEffectiveApr({
    params: { vault: vault.vault },
  });
  const { data: tvl, isLoading: isTvlLoading } = useLeverageYieldTotalAssets({
    params: { vault: vault.vault },
  });
  const position = useUserVaultPosition(vault.vault);

  const aprNegative = apr !== undefined && apr.effectiveNetAprRay < 0n;

  return (
    <Card className={cn("gap-4 bg-linear-to-br", meta.gradient)}>
      {/* Header: glyph + title + ecosystem badge */}
      <div className="flex items-center gap-3 px-(--card-spacing)">
        <div
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background/60 text-lg font-semibold ring-1 ring-foreground/10"
        >
          {meta.glyph}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-heading text-base font-medium leading-snug">
            {meta.title}
          </h3>
          <p className="truncate text-xs text-muted-foreground">{vault.name}</p>
        </div>
        <Badge variant="outline" className="shrink-0 bg-background/60">
          {meta.ecosystem}
        </Badge>
      </div>

      {/* Headline APR + subline */}
      <div className="px-(--card-spacing)">
        {isAprLoading || apr === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-36" />
            <Skeleton className="h-4 w-48" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span
                className={cn(
                  "text-4xl font-semibold tracking-tight tabular-nums",
                  aprNegative
                    ? "text-red-600 dark:text-red-400"
                    : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {aprNegative ? "" : "+"}
                {formatRayAsPercent(apr.effectiveNetAprRay)}
              </span>
              <span className="text-sm text-muted-foreground">
                APR{apr.lsdApr.stale ? " (est.)" : ""}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground tabular-nums">
              <span>{formatWadAsMultiplier(apr.leverageMultiplierWad)} leverage</span>
              <span aria-hidden>·</span>
              {isTvlLoading || tvl === undefined ? (
                <Skeleton className="h-3.5 w-24" />
              ) : (
                <span>
                  {formatTokenAmount(tvl, 18)} {meta.underlyingSymbol} TVL
                </span>
              )}
            </div>
          </>
        )}
        <p className="mt-2 text-sm text-muted-foreground">{meta.strategy}</p>
      </div>

      {/* Expandable APR breakdown */}
      <div className="px-(--card-spacing)">
        <button
          type="button"
          onClick={() => setBreakdownOpen((open) => !open)}
          aria-expanded={breakdownOpen}
          className="flex w-full items-center justify-between rounded-lg py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          APR breakdown
          <CaretDown
            className={cn(
              "size-4 transition-transform",
              breakdownOpen && "rotate-180",
            )}
            aria-hidden
          />
        </button>
        {breakdownOpen ? (
          apr === undefined ? (
            <div className="mt-2 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <div className="mt-2 space-y-2 rounded-lg bg-background/50 p-3 ring-1 ring-foreground/5">
              <BreakdownRow
                label="LSD staking APR"
                sublabel={apr.lsdApr.label}
                value={`+${formatRayAsPercent(apr.lsdApr.aprRay)}`}
              />
              <BreakdownRow
                label="AAVE supply APR"
                value={`+${formatRayAsPercent(apr.supplyAprRay)}`}
              />
              <BreakdownRow
                label="AAVE borrow APR"
                value={`−${formatRayAsPercent(apr.borrowAprRay)}`}
                negative
              />
              <BreakdownRow
                label="Target LTV"
                value={formatBps(apr.targetLtvBps)}
              />
              <BreakdownRow
                label="AAVE-only net"
                value={formatRayAsPercent(apr.netAprRay)}
                muted
              />
              <p className="pt-1 text-xs text-muted-foreground">
                The headline APR includes the LSD&apos;s native staking yield;
                AAVE-only net excludes it.
              </p>
            </div>
          )
        ) : null}
      </div>

      {/* Position strip */}
      {position.hasPosition ? (
        <div className="mx-(--card-spacing) flex items-center justify-between gap-3 rounded-lg bg-background/70 p-3 ring-1 ring-foreground/10">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Your position</p>
            <p className="truncate text-sm font-medium tabular-nums">
              {formatTokenAmount(position.shares, 18)} shares
              {position.underlyingValue !== undefined ? (
                <span className="text-muted-foreground">
                  {" "}
                  ≈ {formatTokenAmount(position.underlyingValue, 18)}{" "}
                  {meta.underlyingSymbol}
                </span>
              ) : null}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => onWithdraw(vault)}
          >
            Withdraw
          </Button>
        </div>
      ) : null}

      {/* Primary CTA */}
      <div className="px-(--card-spacing)">
        <Button className="h-12 w-full text-base" onClick={() => onDeposit(vault)}>
          Deposit
        </Button>
      </div>
    </Card>
  );
}
