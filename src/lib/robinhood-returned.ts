import { erc20Abi, formatUnits, getAddress, isAddress, type Address, type PublicClient } from "viem";
import { sdkAddress } from "@/lib/chains";
import { TOKEN_LISTINGS, type TokenListing } from "@/lib/listings";
import { ROBINHOOD_CHAIN_KEY } from "@/lib/robinhood-sell";

/**
 * What a sell from Robinhood Chain left behind on Sonic (review M1, sell).
 *
 * A sell from the person's own wallet on Robinhood Chain (lib/robinhood-sell)
 * deposits the token on 4663 and the relay carries it to Sonic, where it
 * sits as the listing's hub asset (`rhHubAsset`) in the hub wallet derived
 * for (robinhood, that wallet): not the account's home hub wallet, which is
 * derived for (sonic, the wallet). When the sell fills, nothing stays
 * there. When it does not (it expired, or the solver could not fill it),
 * the token comes back to that hub wallet and waits, and no other reader
 * looks there. These do, so the account still sees and counts it.
 *
 * Both the hub asset and the listing's own Sonic token are read there; each
 * sits in a different hub wallet from every other reader's, so nothing is
 * counted twice. Pure apart from the reads passed in: the browser
 * (hooks/use-account-holdings), the server readers (lib/server/portfolio)
 * and the recovery script (scripts/rh-hubwallet.mjs) share it.
 */

/** The listings a sell from Robinhood Chain can leave behind: those with a token there. */
export const RETURNED_LISTINGS: readonly (TokenListing & { rhAddress: Address; rhHubAsset: Address })[] = TOKEN_LISTINGS.filter(
  (listing): listing is TokenListing & { rhAddress: Address; rhHubAsset: Address } =>
    listing.kind === "stock" && !!listing.rhAddress && !!listing.rhHubAsset,
);

/** One token read in a returned hub wallet: which listing it counts as, and which contract. */
export type ReturnedToken = { symbol: string; token: Address };

/** Every token read per hub wallet, in order: each listing's hub asset, then its Sonic token. */
export const RETURNED_TOKENS: readonly ReturnedToken[] = RETURNED_LISTINGS.flatMap((listing) => [
  { symbol: listing.symbol, token: getAddress(listing.rhHubAsset) },
  { symbol: listing.symbol, token: getAddress(listing.address) },
]);

/** The SDK's hub provider, as much of it as deriving a hub wallet needs. */
export type HubWalletDeriver = {
  getUserHubWalletAddress: (address: never, chainKey: never) => Promise<string>;
};

/** The hub wallet derived for (Robinhood Chain, `owner`): where a sell from there that did not fill comes back to. */
export async function robinhoodHubWallet(hub: HubWalletDeriver, owner: string): Promise<Address> {
  const wallet = await hub.getUserHubWalletAddress(
    sdkAddress(ROBINHOOD_CHAIN_KEY, owner) as never,
    ROBINHOOD_CHAIN_KEY as never,
  );
  return getAddress(wallet);
}

/**
 * Raw balances of every RETURNED_TOKENS entry at each hub wallet, in one
 * multicall on Sonic, as raw amounts per listing symbol (hub asset and
 * Sonic token added), one map per hub wallet in the order given. Throws
 * when the chain does not answer: unknown is never zero.
 */
export async function readReturnedRaw(
  read: Pick<PublicClient, "multicall">,
  hubWallets: readonly Address[],
): Promise<Map<string, bigint>[]> {
  if (hubWallets.length === 0 || RETURNED_TOKENS.length === 0) return hubWallets.map(() => new Map());
  const results = await read.multicall({
    allowFailure: false,
    contracts: hubWallets.flatMap((wallet) =>
      RETURNED_TOKENS.map((entry) => ({
        address: entry.token,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [wallet] as const,
      })),
    ),
  });
  return hubWallets.map((_, walletIndex) => {
    const out = new Map<string, bigint>();
    RETURNED_TOKENS.forEach((entry, index) => {
      const raw = BigInt(results[walletIndex * RETURNED_TOKENS.length + index] as bigint);
      if (raw > 0n) out.set(entry.symbol, (out.get(entry.symbol) ?? 0n) + raw);
    });
    return out;
  });
}

/** Raw amounts by symbol added up over hub wallets. */
export function sumReturnedRaw(parts: readonly Map<string, bigint>[]): Map<string, bigint> {
  const total = new Map<string, bigint>();
  for (const part of parts) for (const [symbol, raw] of part) total.set(symbol, (total.get(symbol) ?? 0n) + raw);
  return total;
}

/** Raw amounts by symbol as listing units (every listing has 18 decimals, as its hub asset does). */
export function returnedUnits(raw: ReadonlyMap<string, bigint>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [symbol, amount] of raw) {
    const listing = RETURNED_LISTINGS.find((entry) => entry.symbol === symbol);
    if (listing && amount > 0n) out[symbol] = Number(formatUnits(amount, listing.decimals));
  }
  return out;
}

/** Only the EVM owners, checksummed, once each. */
export function returnedOwners(owners: readonly string[]): Address[] {
  return [...new Set(owners.filter((owner) => isAddress(owner, { strict: false })).map((owner) => getAddress(owner)))];
}

/**
 * Everything every owner's (robinhood, owner) hub wallet holds of the
 * listings, as raw amounts by symbol. Throws when a hub wallet cannot be
 * derived or read.
 */
export async function readReturned(
  hub: HubWalletDeriver,
  read: Pick<PublicClient, "multicall">,
  owners: readonly string[],
): Promise<{ total: Map<string, bigint>; byOwner: Map<Address, { hubWallet: Address; raw: Map<string, bigint> }> }> {
  const wanted = returnedOwners(owners);
  const hubWallets = await Promise.all(wanted.map((owner) => robinhoodHubWallet(hub, owner)));
  const raws = await readReturnedRaw(read, hubWallets);
  const byOwner = new Map<Address, { hubWallet: Address; raw: Map<string, bigint> }>();
  wanted.forEach((owner, index) => byOwner.set(owner, { hubWallet: hubWallets[index], raw: raws[index] }));
  return { total: sumReturnedRaw(raws), byOwner };
}
