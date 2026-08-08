"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useSodaxContext } from "@sodax/dapp-kit";
import { useCopy, useMoney } from "@/components/settings-provider";
import { useEmbeddedHoldings } from "@/hooks/use-embedded-holdings";
import { useEarnedYield } from "@/hooks/use-earned-yield";
import { useUserVaultPosition } from "@/hooks/use-user-vault-position";
import { useUsdPrices } from "@/hooks/use-usd-prices";

/**
 * Everything on the table, in one figure: the teapot's sweep plus every
 * steeping cup — and underneath it, what the table has EARNED overall:
 * gains still brewing in the cups plus gains already banked by pour-backs
 * (the anchor ledger's realized side), summed across vaults in money.
 * Token overrides do the theming, so the rows need no per-mode styling,
 * only per-mode labels.
 *
 * Fixed hook slots for the cups, same reasoning as the shelf's
 * useFilledCups: hooks can't loop, the shelf holds at most a handful, and
 * every read here is cache-shared with the cups' own cards.
 */
function useTableUsd(): { cupsUsd: number; earnedUsd: number } {
  const { sodax } = useSodaxContext();
  const vaults = sodax.leverageYield.listVaults();
  const prices = useUsdPrices();
  const positions = [
    useUserVaultPosition(vaults[0]?.vault),
    useUserVaultPosition(vaults[1]?.vault),
    useUserVaultPosition(vaults[2]?.vault),
    useUserVaultPosition(vaults[3]?.vault),
    useUserVaultPosition(vaults[4]?.vault),
    useUserVaultPosition(vaults[5]?.vault),
  ];
  const earnings = [
    useSlotEarned(vaults[0]?.vault, positions[0]),
    useSlotEarned(vaults[1]?.vault, positions[1]),
    useSlotEarned(vaults[2]?.vault, positions[2]),
    useSlotEarned(vaults[3]?.vault, positions[3]),
    useSlotEarned(vaults[4]?.vault, positions[4]),
    useSlotEarned(vaults[5]?.vault, positions[5]),
  ];

  return vaults.reduce(
    (sum, vault, index) => {
      const price = prices.priceOfHubAsset(vault.asset);
      if (price === undefined) return sum;

      const underlying = positions[index]?.underlyingValue;
      const cupsUsd =
        sum.cupsUsd +
        (underlying !== undefined
          ? Number(formatUnits(underlying, 18)) * price
          : 0);

      // Brewing gain (can be sawtooth-negative; the sum stays honest) plus
      // whatever pour-backs already banked.
      const slot = earnings[index];
      const gain =
        (slot.earned !== undefined
          ? Number(formatUnits(slot.earned, 18))
          : 0) +
        (slot.realized !== undefined
          ? Number(formatUnits(slot.realized, 18))
          : 0);
      return { cupsUsd, earnedUsd: sum.earnedUsd + gain * price };
    },
    { cupsUsd: 0, earnedUsd: 0 },
  );
}

function useSlotEarned(
  vault: string | undefined,
  position: ReturnType<typeof useUserVaultPosition>,
) {
  return useEarnedYield({
    vault,
    shares: position.shares,
    pricePerShare: position.pricePerShare,
    ownerKey: position.ownerKey,
    ready: position.sharesSettled,
  });
}

/**
 * Glides the displayed number to a fresh value over ~350ms instead of
 * teleporting — the header is exactly what the user watches right after a
 * pour lands. First mount shows the value as-is (no count-up from zero).
 * The digits themselves may move (they tick on the cards too); the banned
 * thing is decoration ON the digits, per the motion-next-to-money rule.
 */
function useGlide(value: number): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 350);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (value - from) * eased;
      shownRef.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

export function TableTotal() {
  const copy = useCopy();
  const money = useMoney();
  const teapot = useEmbeddedHoldings();
  const { cupsUsd, earnedUsd } = useTableUsd();

  // Wallet guests have no embedded sweep; their cups still count. Nothing
  // priced yet (or genuinely empty) renders nothing — a €0 headline is noise.
  const total = (teapot.totalUsd ?? 0) + cupsUsd;
  const shownTotal = useGlide(total);
  const shownEarned = useGlide(earnedUsd);
  if (total <= 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-0.5 px-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{copy.onTheTable}</span>
        <span className="money text-sm font-semibold text-foreground">
          ≈ {money.format(shownTotal)}
        </span>
      </div>
      {/* The trophy line: only once there is genuinely something to show —
          sawtooth noise stays below the fold, a real gain gets its place. */}
      {earnedUsd > 0 && (
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">
            {copy.earnedOverall}
          </span>
          <span className="money text-xs font-medium text-primary">
            +{money.formatPrecise(shownEarned)}
          </span>
        </div>
      )}
    </div>
  );
}
