/**
 * Pure core of `useUsdPrices`: the two-source price precedence rule.
 *
 * The money market oracle (keyed by hub address) is authoritative; symbol
 * prices from the market feed only fill its gaps. Reserves are keyed by their
 * hub underlying, which for vaulted deposits is the soda vault, so `vault` is
 * tried before `hubAsset`. Anything neither source knows stays undefined.
 */

/** The slice of `XToken` the precedence rule actually reads. */
export type PriceLookupToken = {
  vault: string;
  hubAsset: string;
  symbol: string;
};

export function resolveTokenUsdPrice(
  token: PriceLookupToken,
  priceByHubAddress: ReadonlyMap<string, number>,
  priceBySymbol: ReadonlyMap<string, number>,
): number | undefined {
  return (
    priceByHubAddress.get(token.vault.toLowerCase()) ??
    priceByHubAddress.get(token.hubAsset.toLowerCase()) ??
    priceBySymbol.get(token.symbol.toLowerCase())
  );
}
