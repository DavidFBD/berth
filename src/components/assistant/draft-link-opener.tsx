"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCopy } from "@/components/settings-provider";
import { useHubAccount } from "@/hooks/use-hub-account";
import { useHubHoldings } from "@/hooks/use-hub-holdings";
import { readDraftParams, type DraftParams } from "@/lib/draft-order";
import { draftOpening, type DraftOpening } from "@/lib/draft-open";
import type { Copy } from "@/lib/copy";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";

const DRAFT_KEYS = ["open", "side", "usd", "qty"] as const;

/** How long a sell waits for the holdings before saying it could not check them. */
export const DRAFT_SELL_WAIT_MS = 20_000;

/**
 * Opens the order drawer an assistant's draft points at
 * (`/?open=NVDA&side=buy&usd=50`, built by lib/draft-order). Mounted inside
 * the sign in gate, so someone arriving signed out signs in first and the
 * drawer opens after. It only fills the drawer in: the person still picks
 * what to pay with and signs, or closes it. The parameters are taken out
 * of the address bar once read, so a reload does not reopen it. A sell
 * waits for the holdings, but not forever: if a read fails, or
 * DRAFT_SELL_WAIT_MS passes without them (an account that never resolves
 * a hub wallet included), it gives up, clears the link and says so.
 *
 * Renders nothing.
 */
export function DraftLinkOpener({
  onBuy,
  onSell,
}: {
  onBuy: (listing: TokenListing, prefill: { usd?: number }) => void;
  onSell: (listing: TokenListing, prefill: { usd?: number; quantity?: number }) => void;
}) {
  const copy = useCopy();
  const account = useHubAccount();
  const holdings = useHubHoldings(account.hubWallets);
  // Read once, at mount, on the client: this component never renders on the server.
  const pending = useRef<DraftParams | null | undefined>(undefined);
  if (pending.current === undefined) {
    pending.current = typeof window === "undefined" ? null : readDraftParams(new URLSearchParams(window.location.search));
  }

  const [waitedOut, setWaitedOut] = useState(false);
  useEffect(() => {
    if (!pending.current || pending.current.side !== "sell") return;
    const timer = setTimeout(() => setWaitedOut(true), DRAFT_SELL_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  // No hub wallet yet is not a verdict (a signed in wallet can still be
  // hydrating); only a failed read or the wait running out is.
  const holdingsUnknown = Boolean(account.error) || Boolean(holdings.error) || waitedOut;

  useEffect(() => {
    const draft = pending.current;
    if (!draft) return;
    const listing = TOKEN_LISTINGS.find((candidate) => candidate.symbol === draft.symbol);
    // A sell waits for the holdings, to know there is something to sell.
    if (listing && draft.side === "sell" && !holdings.settled && !holdingsUnknown) return;
    pending.current = null;

    const url = new URL(window.location.href);
    for (const key of DRAFT_KEYS) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url);

    const opening = draftOpening(draft, {
      settled: holdings.settled,
      heldAddresses: holdings.held.map((holding) => holding.listing.address),
    });
    if (!showDraftOpening(opening, copy, { onBuy, onSell })) return;
    toast(copy.draftOpenedTitle, { description: copy.draftOpenedBody });
  }, [holdings.settled, holdings.held, holdingsUnknown, onBuy, onSell, copy]);

  return null;
}

/**
 * Carry out a draft opening: open the drawer it names, or say in a toast
 * why not. True when a drawer opened. Shared with the chat's draft card.
 */
export function showDraftOpening(
  opening: DraftOpening,
  copy: Pick<Copy, "draftUnknownListing" | "draftCouldNotCheck" | "draftNothingToSell">,
  open: {
    onBuy: (listing: TokenListing, prefill: { usd?: number }) => void;
    onSell: (listing: TokenListing, prefill: { usd?: number; quantity?: number }) => void;
  },
): boolean {
  switch (opening.kind) {
    case "unknown":
      toast.error(copy.draftUnknownListing);
      return false;
    case "cannot_check":
      toast(copy.draftCouldNotCheck(opening.listing.name));
      return false;
    case "nothing_to_sell":
      toast(copy.draftNothingToSell(opening.listing.name));
      return false;
    case "buy":
      open.onBuy(opening.listing, opening.prefill);
      return true;
    case "sell":
      open.onSell(opening.listing, opening.prefill);
      return true;
  }
}
