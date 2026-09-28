import type { DraftParams } from "@/lib/draft-order";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";

/**
 * What opening a draft does, decided once for both ways a draft arrives:
 * a link from a connected assistant (components/assistant/draft-link-opener)
 * and a card in the in-app chat (components/chat). A buy opens the buy
 * drawer; a sell opens only when the holdings have been read and hold the
 * listing, so both paths refuse the same way. Pure.
 */
export type DraftOpening =
  | { kind: "buy"; listing: TokenListing; prefill: { usd?: number } }
  | { kind: "sell"; listing: TokenListing; prefill: { usd?: number; quantity?: number } }
  | { kind: "unknown" }
  | { kind: "cannot_check"; listing: TokenListing }
  | { kind: "nothing_to_sell"; listing: TokenListing };

export function draftOpening(
  draft: DraftParams,
  holdings: { settled: boolean; heldAddresses: readonly string[] },
): DraftOpening {
  const listing = TOKEN_LISTINGS.find((candidate) => candidate.symbol === draft.symbol.toUpperCase());
  if (!listing) return { kind: "unknown" };
  if (draft.side === "buy") return { kind: "buy", listing, prefill: { usd: draft.usd } };
  if (!holdings.settled) return { kind: "cannot_check", listing };
  const address = listing.address.toLowerCase();
  if (!holdings.heldAddresses.some((held) => held.toLowerCase() === address)) return { kind: "nothing_to_sell", listing };
  return { kind: "sell", listing, prefill: { usd: draft.usd, quantity: draft.quantity } };
}
