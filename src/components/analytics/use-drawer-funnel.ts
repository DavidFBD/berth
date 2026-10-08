"use client";

import { useEffect, useRef } from "react";
import { getChainType, type SpokeChainKey } from "@sodax/sdk";
import { amountBucket, chainFamily, track } from "@/lib/analytics";
import { trackGasBlocked } from "@/lib/gas-message";

/**
 * The buy or sell drawer's half of the order funnel (lib/analytics); the
 * order machine (hooks/use-vault-action) says the rest, from sign requested
 * to filled or failed. Each step once per opening. The amount goes out only
 * as a bucket, after the typing settles; the token only as its chain family.
 */
export function useDrawerFunnel({
  side,
  open,
  listing,
  chainKey,
  usd,
  quoted,
  limitActive,
  gasBlocked,
  refused,
}: {
  side: "buy" | "sell";
  open: boolean;
  listing: { symbol: string; kind: string } | null;
  /** The pay (buy) or receive (sell) token's chain, once a token is chosen. */
  chainKey: SpokeChainKey | null | undefined;
  usd: number | undefined;
  quoted: boolean;
  limitActive: boolean;
  /**
   * The signing chain and shortfall while the order the person is making is
   * stopped for gas (lib/gas-need): pass it only once they have typed an
   * amount, never for a token merely preselected on opening.
   */
  gasBlocked?: { chainKey: SpokeChainKey; shortfall: string } | null;
  /**
   * The quote refusal on screen (lib/quote-hold), once it is more than a
   * blip: the pair's kind, the reason as a code and the solver's error
   * number. No pair, no address, no amount beyond the bucket.
   */
  refused?: { pairKind: "stock" | "crypto"; reason: string; errorNumber: string } | null;
}): void {
  const said = useRef(new Set<string>());
  const once = (key: string, send: () => void) => {
    if (said.current.has(key)) return;
    said.current.add(key);
    send();
  };

  useEffect(() => {
    if (!open) said.current = new Set();
  }, [open]);

  const symbol = listing?.symbol;
  const kind = listing?.kind;
  useEffect(() => {
    if (open && symbol && kind) once(`opened:${symbol}`, () => track(`${side}_drawer_opened`, { listing: symbol, listing_kind: kind }));
  });

  const family = chainKey ? chainFamily(getChainType(chainKey)) : null;
  useEffect(() => {
    if (!open || !family) return;
    once(`chain:${family}`, () =>
      side === "buy"
        ? track("buy_pay_token_chosen", { chain_family: family })
        : track("sell_receive_token_chosen", { chain_family: family }),
    );
  });

  const bucket = amountBucket(usd);
  useEffect(() => {
    if (!open || !bucket) return;
    // Typing passes through every bucket on the way; only a pause counts.
    const timer = setTimeout(() => once(`amount:${bucket}`, () => track(`${side}_amount_entered`, { amount_bucket: bucket })), 900);
    return () => clearTimeout(timer);
  }, [open, bucket, side]);

  useEffect(() => {
    if (open && quoted && bucket) once(`quote:${bucket}`, () => track(`${side}_quote_shown`, { amount_bucket: bucket }));
  });

  useEffect(() => {
    if (open && limitActive) once("limit", () => track("limit_started", { side }));
  });

  useEffect(() => {
    if (!open || !refused) return;
    // Once per opening for each kind of refusal: a flapping solver is one event, not one per refresh.
    once(`refused:${refused.pairKind}:${refused.reason}`, () =>
      track("quote_refused", {
        side,
        pair_kind: refused.pairKind,
        reason: refused.reason,
        error_number: refused.errorNumber,
        ...(bucket && { amount_bucket: bucket }),
      }),
    );
  });

  useEffect(() => {
    if (open && gasBlocked)
      once(`gas:${gasBlocked.chainKey}`, () =>
        trackGasBlocked({ side, chain: gasBlocked.chainKey, shortfall: gasBlocked.shortfall }),
      );
  });
}
