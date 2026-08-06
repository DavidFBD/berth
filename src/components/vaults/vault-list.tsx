"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { AnimatePresence, motion } from "motion/react";
import {
  useLeverageYieldEffectiveApr,
  useSodaxContext,
  type LeverageYieldVault,
} from "@sodax/dapp-kit";

import { Skeleton } from "@/components/ui/skeleton";
import { CupArt, SteamPlume } from "@/components/tea/tea-art";
import { SILK_CUP } from "@/components/tea/silk";
import { useUserVaultPosition } from "@/hooks/use-user-vault-position";
import { formatRayAsPercent } from "@/lib/format";
import { getVaultMeta } from "@/lib/vaults-meta";
import { cn } from "@/lib/utils";
import { VaultCard } from "./vault-card";

/**
 * Which cups hold tea, in shelf order. Fixed hook slots because hooks can't
 * run in a loop and the shelf holds at most a handful; an out-of-range slot
 * gets `undefined` and its queries simply stay disabled. Cache-shared with
 * each cup's own position read, so this costs no extra RPC.
 */
function useFilledCups(vaults: readonly LeverageYieldVault[]): boolean[] {
  const positions = [
    useUserVaultPosition(vaults[0]?.vault),
    useUserVaultPosition(vaults[1]?.vault),
    useUserVaultPosition(vaults[2]?.vault),
    useUserVaultPosition(vaults[3]?.vault),
    useUserVaultPosition(vaults[4]?.vault),
    useUserVaultPosition(vaults[5]?.vault),
  ];
  return vaults.map((_, index) => positions[index]?.hasPosition ?? false);
}

/**
 * The tea shelf — every blend minimized to its cup, lined up on one board.
 * Tapping a cup lifts it and steeps the full cup card open underneath;
 * tapping it again (or another cup) puts it back. Nothing is expanded by
 * default: the home screen is the teapot, the shelf, and calm.
 */
export function VaultList({
  onDeposit,
  onWithdraw,
  bloomVault,
}: {
  onDeposit: (v: LeverageYieldVault) => void;
  onWithdraw: (v: LeverageYieldVault) => void;
  /** Vault address whose cup should bloom (post-pour celebration). */
  bloomVault?: string | null;
}) {
  const { sodax } = useSodaxContext();
  const vaults = sodax.leverageYield.listVaults();
  const [selected, setSelected] = useState<string | null>(null);

  // Your cups stay vivid; the rest step back. Only meaningful once at least
  // one cup holds tea — an all-empty shelf stays fully warm, since greying
  // everything would just read as a broken theme.
  const filled = useFilledCups(vaults);
  const anyFilled = filled.some(Boolean);

  // Post-pour the celebration must be visible: open the poured cup's card.
  // Render-time state adjustment (not an effect), per house pattern.
  const [bloomSeen, setBloomSeen] = useState<string | null>(null);
  if (bloomVault && bloomVault !== bloomSeen) {
    setBloomSeen(bloomVault);
    setSelected(bloomVault);
  }

  if (vaults.length === 0) {
    return (
      <p className="rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">
        No vaults are available right now. Check back soon.
      </p>
    );
  }

  const active = vaults.find((vault) => vault.vault === selected) ?? null;

  return (
    <div>
      {/* The shelf: cups sit on the board; the board is a warm wooden line. */}
      <div className="rounded-2xl border border-border bg-card px-3 pt-3 pb-4 shadow-sm">
        <div className="grid grid-cols-3 items-end">
          {vaults.map((vault, index) => (
            <ShelfCup
              key={vault.vault}
              vault={vault}
              selected={vault.vault === selected}
              dimmed={
                anyFilled && !filled[index] && vault.vault !== selected
              }
              onSelect={() =>
                setSelected((current) =>
                  current === vault.vault ? null : vault.vault,
                )
              }
            />
          ))}
        </div>
        <div
          aria-hidden
          className="mx-1 h-2 rounded-full"
          style={{
            background:
              "color-mix(in oklch, var(--primary) 60%, var(--border))",
            boxShadow: "0 2px 4px -2px color-mix(in oklch, var(--primary) 45%, transparent)",
          }}
        />
        <p className="mt-2.5 text-center text-[11.5px] text-muted-foreground">
          {active ? " " : "Three blends, warmed and waiting. Pick a cup."}
        </p>
      </div>

      {/* The picked cup steeps open below the shelf. */}
      <AnimatePresence initial={false} mode="wait">
        {active && (
          <motion.div
            key={active.vault}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="overflow-hidden"
          >
            <div className="pt-4">
              <VaultCard
                vault={active}
                onDeposit={onDeposit}
                onWithdraw={onWithdraw}
                bloom={active.vault === bloomVault}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** One cup on the shelf: live steam, live APY, lifts when picked. */
function ShelfCup({
  vault,
  selected,
  dimmed,
  onSelect,
}: {
  vault: LeverageYieldVault;
  selected: boolean;
  /** True when another cup holds tea and this one doesn't: step back. */
  dimmed: boolean;
  onSelect: () => void;
}) {
  const meta = getVaultMeta(vault.name);
  const accent = `var(--cup-${meta.cupKey})`;
  const deep = `var(--cup-${meta.cupKey}-deep)`;

  const { data: apr } = useLeverageYieldEffectiveApr({
    params: { vault: vault.vault },
  });
  const position = useUserVaultPosition(vault.vault);

  const steeping =
    position.underlyingValue !== undefined
      ? Number(formatUnits(position.underlyingValue, 18))
      : 0;
  const hasTea = position.hasPosition;
  const [t1, t2, t3] = meta.steamThresholds;
  const steamLevel = !hasTea
    ? 0
    : steeping >= t3
      ? 4
      : steeping >= t2
        ? 3
        : steeping >= t1
          ? 2
          : 1;
  const fill = !hasTea ? 0 : Math.min(1, 0.25 + (steeping / t3) * 0.75);
  const aprNegative = apr !== undefined && apr.effectiveNetAprRay < 0n;

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      aria-expanded={selected}
      aria-label={`${meta.teaName}: ${selected ? "put the cup back" : "take the cup down"}`}
      whileTap={{ scale: 0.93 }}
      animate={{ y: selected ? -6 : 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      className={cn(
        "flex flex-col items-center pb-2 transition-[opacity,filter] duration-300",
        // Muted, not invisible: a dimmed cup is still on offer, it just
        // isn't yours yet.
        dimmed && "opacity-45 saturate-[0.3]",
      )}
    >
      <SteamPlume level={steamLevel} width={54} height={26} />
      <CupArt
        accent={accent}
        deep={deep}
        fill={fill}
        bowl={meta.cupKey === "sencha"}
        size={62}
        silk={SILK_CUP[meta.cupKey]}
      />
      <span
        className={cn(
          "mt-1.5 font-display text-[13px] leading-tight transition-colors",
          selected ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {meta.teaName}
      </span>
      {apr === undefined ? (
        <Skeleton className="mt-0.5 h-3.5 w-10" />
      ) : (
        <span
          className="money mt-0.5 text-xs font-semibold"
          style={{ color: aprNegative ? "var(--destructive)" : deep }}
        >
          {formatRayAsPercent(apr.effectiveNetAprRay)}
        </span>
      )}
      <span
        aria-hidden
        className={cn(
          "mt-1 size-1.5 rounded-full transition-opacity duration-300",
          selected ? "opacity-100" : "opacity-0",
        )}
        style={{ background: deep }}
      />
    </motion.button>
  );
}
