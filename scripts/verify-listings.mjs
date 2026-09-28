// Checks the pinned token listings (src/lib/listings.ts) against the world:
// the backend's live Sonic token list, and symbol() / decimals() read from
// the token contracts on chain. The registry is a hand-carried snapshot
// because @sodax/sdk 2.0.0 knows none of these tokens and the SDK config is
// frozen at import time; this script is what makes "pinned" honest.
//
// Usage: pnpm listings:verify
// Exit 1 on any drift, with every difference printed, so it can gate a
// release. Read-only: no key, no wallet, no funds.
import { createPublicClient, http, parseAbi } from "viem";

// Node strips the types from the .ts import (see the flag in package.json),
// so the script reads the very table the app ships, not a copy of it.
const { TOKEN_LISTINGS, CASH_LISTING, LISTING_MARK_BY_SYMBOL } = await import(
  "../src/lib/listings.ts"
);

const TOKENS_URL = "https://api.sodax.com/v1/swaps/tokens/sonic";
const SONIC_RPC =
  process.env.SONIC_RPC_URL ?? "https://sonic-rpc.publicnode.com";

const erc20 = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const problems = [];
const note = (message) => problems.push(message);
const lower = (address) => address.toLowerCase();

// 1. The backend's list: every listing must be there with the same symbol,
//    name, decimals and a self-referential hub asset; and every Robinhood
//    token the backend trades must be a listing, or the shelf is behind.
const response = await fetch(TOKENS_URL, { signal: AbortSignal.timeout(20_000) });
if (!response.ok) {
  console.error(`GET ${TOKENS_URL} answered ${response.status}`);
  process.exit(1);
}
const live = await response.json();
const liveByAddress = new Map(live.map((token) => [lower(token.address), token]));

for (const listing of TOKEN_LISTINGS) {
  const served = liveByAddress.get(lower(listing.address));
  if (!served) {
    note(`${listing.symbol}: not in the backend's Sonic token list`);
    continue;
  }
  if (served.symbol !== listing.symbol)
    note(`${listing.symbol}: backend symbol is ${served.symbol}`);
  if (served.name !== listing.issuerName)
    note(`${listing.symbol}: backend name is "${served.name}"`);
  if (served.decimals !== listing.decimals)
    note(`${listing.symbol}: backend decimals ${served.decimals}`);
  if (served.address !== listing.address)
    note(`${listing.symbol}: backend casing ${served.address}`);
  if (lower(served.hubAsset ?? "") !== lower(listing.address))
    note(`${listing.symbol}: backend hubAsset is ${served.hubAsset}, not the token itself`);
  if (lower(served.vault ?? "") !== lower(listing.address))
    note(`${listing.symbol}: backend vault is ${served.vault}, not the token itself`);
}

const pinned = new Set(TOKEN_LISTINGS.map((listing) => lower(listing.address)));
const robinhood = live.filter((token) => /Robinhood Token$/.test(token.name ?? ""));
for (const token of robinhood) {
  if (!pinned.has(lower(token.address)))
    note(`backend trades ${token.symbol} (${token.address}) but the registry doesn't list it`);
}

// 2. The chain: the contract at each address must answer the pinned symbol
//    and 18 decimals. A wrong address here is money sent to the wrong place.
const client = createPublicClient({ transport: http(SONIC_RPC) });
const reads = await Promise.all(
  TOKEN_LISTINGS.map(async (listing) => {
    try {
      const [symbol, name, decimals] = await Promise.all([
        client.readContract({ address: listing.address, abi: erc20, functionName: "symbol" }),
        client.readContract({ address: listing.address, abi: erc20, functionName: "name" }),
        client.readContract({ address: listing.address, abi: erc20, functionName: "decimals" }),
      ]);
      return { listing, symbol, name, decimals };
    } catch (error) {
      return { listing, error };
    }
  }),
);
for (const read of reads) {
  const { listing } = read;
  if (read.error) {
    note(`${listing.symbol}: chain read failed at ${listing.address}: ${read.error.shortMessage ?? read.error.message}`);
    continue;
  }
  if (read.symbol !== listing.symbol)
    note(`${listing.symbol}: contract symbol() is ${read.symbol}`);
  if (read.name !== listing.issuerName)
    note(`${listing.symbol}: contract name() is "${read.name}"`);
  if (Number(read.decimals) !== listing.decimals)
    note(`${listing.symbol}: contract decimals() is ${read.decimals}`);
}

// 3. Icon coverage. Informational only, not a drift check: a listing with
//    no mark in LISTING_MARK_BY_SYMBOL draws the lettered TickerTile
//    fallback (company-marks.tsx), which is a deliberate design choice for
//    tickers Simple Icons has no clean mark for, not a bug to fail the
//    build over.
const lettered = TOKEN_LISTINGS.filter((listing) => !LISTING_MARK_BY_SYMBOL[listing.symbol]);
if (lettered.length > 0) {
  console.log(
    `${lettered.length} listing(s) drawing the letter badge (no mark pinned): ${lettered
      .map((listing) => listing.symbol)
      .join(", ")}.`,
  );
}

// 4. Report.
console.log(
  `${TOKEN_LISTINGS.length} listings pinned, ${robinhood.length} Robinhood tokens served, cash is ${CASH_LISTING.symbol}.`,
);
if (problems.length === 0) {
  console.log("Registry matches the backend and the chain.");
  process.exit(0);
}
console.error(`${problems.length} difference(s):`);
for (const problem of problems) console.error(`  - ${problem}`);
process.exit(1);
