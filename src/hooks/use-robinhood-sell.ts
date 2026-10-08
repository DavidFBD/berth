"use client";

import { useQuery } from "@tanstack/react-query";
import type { HubAccount } from "@/hooks/use-hub-account";
import { LISTINGS_QUERY_KEY } from "@/hooks/use-hub-holdings";
import { robinhoodOwners } from "@/lib/account-holdings";
import type { TokenListing } from "@/lib/listings";
import { readRobinhoodBalancesByOwner, robinhoodClient } from "@/lib/robinhood-chain";

/** The whole read, past which it counts as failed, whatever the endpoints are doing. */
const READ_CAP_MS = 12_000;

/**
 * What each of the account's EVM wallets holds of one listing on Robinhood
 * Chain, wallet by wallet, for the sell sheet's sources (lib/robinhood-sell
 * robinhoodSellSources): a sell from there spends one wallet's tokens,
 * signed by that wallet, so the figure is each wallet's own, never the sum
 * the holdings list shows. Read only while the sheet is open, for a stock
 * with a token there and an account with an EVM wallet; otherwise no call.
 *
 * `settled` is true once this opening's read answered or failed (or there
 * was nothing to read): a failed read offers no Robinhood Chain source, and the sheet
 * sells from the Berth account as before.
 */
export function useRobinhoodSellBalances(
  listing: TokenListing | null,
  account: Pick<HubAccount, "wallets" | "signerSpoke">,
  open: boolean,
): { held: { owner: string; balance: bigint }[]; settled: boolean } {
  const owners = robinhoodOwners(account);
  const rhAddress = listing?.kind === "stock" ? listing.rhAddress : undefined;
  const enabled = open && !!rhAddress && owners.length > 0;
  const query = useQuery({
    queryKey: [...LISTINGS_QUERY_KEY, "robinhood-sell", rhAddress ?? "", owners.join(",")],
    enabled,
    retry: 1,
    retryDelay: 800,
    staleTime: 10_000,
    queryFn: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const byOwner = await Promise.race([
          readRobinhoodBalancesByOwner(robinhoodClient(), [{ rhAddress: rhAddress! }], owners),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Robinhood Chain read timed out")), READ_CAP_MS);
          }),
        ]);
        return owners.map((owner, index) => ({ owner: owner.toLowerCase(), balance: byOwner[index]?.[0] ?? 0n }));
      } finally {
        clearTimeout(timer);
      }
    },
  });
  if (!enabled) return { held: [], settled: true };
  // Never an earlier opening's figure: settled only once this opening's read is in.
  return { held: query.data ?? [], settled: !query.isFetching && (query.isSuccess || query.isError) };
}
