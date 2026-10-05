"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useAddFunds } from "@privy-io/react-auth";
import { CheckCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ThinkingOrb } from "@/components/ui/thinking-orb";
import { useCopy, useMoney } from "@/components/settings-provider";
import { readUsdcOnBase, type FundingWatch } from "@/hooks/use-funding-handoff";
import { FUND_CHAIN_CAIP, FUND_USDC_BASE, fundingOutcome, offersPayAnotherWay, readBaseline, usdcToUsd, type ArrivalView } from "@/lib/funding-handoff";
import { track } from "@/lib/analytics";
import { toast } from "@/lib/toast";

/**
 * Adding money, and what follows it (lib/funding-handoff). One way in for
 * every surface that offers a card payment: the path's money step, the
 * Add money drawer and the account drawer all call `useAddMoney`, which
 * opens Privy's funding window for USDC on Base and, once the person is
 * done there, hands the wait to whoever provides `FundingProvider` (the
 * home), so the money is watched in one place and the buy follows it.
 * Outside a provider it says "Money added" in a toast, as it always did.
 */

const FundingContext = createContext<((watch: FundingWatch) => void) | null>(null);

export function FundingProvider({ onFunded, children }: { onFunded: (watch: FundingWatch) => void; children: ReactNode }) {
  return <FundingContext.Provider value={onFunded}>{children}</FundingContext.Provider>;
}

/** Display currencies Privy's card window can start in; anything else starts in its own default. */
const FIAT_START = new Set(["usd", "eur", "gbp", "chf", "sek", "dkk", "nok", "pln", "czk", "jpy", "cad", "aud"]);

/**
 * Opens Privy's funding window to `address`, landing USDC on Base. The
 * balance before is read alongside, never ahead of the window (a wait
 * there would cost the tap its gesture), so the wait can tell new money
 * from old; it is tried a few times, each read capped, so it has answered
 * (or honestly failed) long before the person is done paying. A closed
 * window rejects and says nothing.
 */
export function useAddMoney(surface: string): (address: string) => void {
  const { addFunds } = useAddFunds();
  const onFunded = useContext(FundingContext);
  const copy = useCopy();
  const money = useMoney();
  const currency = money.currency.toLowerCase();
  return useCallback(
    (address: string) => {
      const startedAt = Date.now();
      const baseline = readBaseline(() => readUsdcOnBase(address));
      track("add_money_opened", { surface });
      addFunds({
        destination: { address, chain: FUND_CHAIN_CAIP, asset: FUND_USDC_BASE },
        fiat: FIAT_START.has(currency)
          ? { source: { defaultAsset: currency as "usd" } }
          : {},
        crypto: {},
      })
        .then(async (result) => {
          if (fundingOutcome(result) !== "sent") return;
          track("add_money_sent", { method: result.method });
          if (!onFunded) {
            toast.success(copy.fundsAddedTitle, { description: copy.fundsAddedBody });
            return;
          }
          onFunded({ address, baseline: await baseline, startedAt });
        })
        .catch(() => {
          // A plain exit rejects too; Privy says anything else in its own window.
        });
    },
    [addFunds, onFunded, copy, currency, surface],
  );
}

/**
 * The wait, and the arrival, in the Add money drawer's place. One orb in
 * ink while the money is on its way, a plain line when it is slow, none
 * once the watch has stopped.
 */
export function ArrivalPanel({
  view,
  target,
  listingName,
  onChoose,
  onPayAnotherWay,
  onClose,
}: {
  view: ArrivalView;
  /** What follows the arrival (lib/funding-handoff handoffTarget). */
  target: "buy" | "choose" | "none";
  /** The order that asked for the money, when one did. */
  listingName?: string;
  onChoose: () => void;
  /** Stops the wait and shows the ways to pay again, so a card payment that failed never holds the person here. */
  onPayAnotherWay: () => void;
  onClose: () => void;
}) {
  const copy = useCopy().funding;
  const money = useMoney();
  if (view.kind === "arrived") {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-4 px-1 py-2">
        <div className="flex items-start gap-3">
          <CheckCircle weight="duotone" aria-hidden className="mt-0.5 size-8 shrink-0 text-foreground" />
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="font-heading text-[19px] leading-snug tracking-[-0.02em] text-foreground">{copy.arrivedTitle}</h3>
            <p data-ph-mask className="text-[14.5px] leading-[1.55] text-muted-foreground">
              {copy.arrivedLine(money.format(usdcToUsd(view.amount)))}{" "}
              {target === "none" ? copy.arrivedAway : target === "buy" && listingName ? copy.arrivedOpening(listingName) : null}
            </p>
          </div>
        </div>
        {target === "choose" ? (
          <Button className="h-11 w-full rounded-full text-[15px] font-medium" onClick={onChoose}>
            {copy.arrivedChoose}
          </Button>
        ) : target === "none" ? (
          <Button variant="outline" className="h-11 w-full rounded-full text-[15px]" onClick={onClose}>
            {copy.close}
          </Button>
        ) : null}
      </div>
    );
  }
  const stopped = view.kind === "stopped";
  const unknown = view.kind === "unknown";
  const waiting = view.kind === "waiting";
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4 px-1 py-2">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center">
          {waiting && <ThinkingOrb size={32} tone="ink" decorative />}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="font-heading text-[19px] leading-snug tracking-[-0.02em] text-foreground">
            {stopped ? copy.stoppedTitle : unknown ? copy.unknownTitle : copy.waitingTitle}
          </h3>
          <p className="text-[14.5px] leading-[1.55] text-muted-foreground">
            {stopped ? copy.stoppedLine : unknown ? copy.unknownLine : view.slow ? copy.slowLine : copy.waitingLine}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {offersPayAnotherWay(view) && (
          <Button variant="outline" className="h-11 w-full rounded-full text-[15px]" onClick={onPayAnotherWay}>
            {copy.payAnotherWay}
          </Button>
        )}
        <Button variant="ghost" className="h-11 w-full rounded-full text-[15px]" onClick={onClose}>
          {copy.close}
        </Button>
        {waiting && <p className="text-center text-xs text-muted-foreground">{copy.payAnotherWayLine}</p>}
      </div>
    </div>
  );
}
