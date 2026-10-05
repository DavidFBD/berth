// Checks the pinned token listings (src/lib/listings.ts) against the world:
// the backend's live Sonic token list, the Robinhood Chain twins
// (lib/market-ids) against the backend's robinhood list, a price from the
// solver oracle for each, and symbol() / decimals() read from the token
// contracts on chain. The registry is a hand-carried snapshot
// because @sodax/sdk 2.0.0 knows none of these tokens and the SDK config is
// frozen at import time; this script is what makes "pinned" honest.
//
// Usage: pnpm listings:verify
// Exit 1 on any drift, with every difference printed, so it can gate a
// release. Read-only: no key, no wallet, no funds.
import { createPublicClient, http, parseAbi } from "viem";
import { Sodax, assetManagerAbi } from "@sodax/sdk";

// Node strips the types from the .ts import (see the flag in package.json),
// so the script reads the very table the app ships, not a copy of it.
const { TOKEN_LISTINGS, CASH_LISTING, LISTING_MARK_BY_SYMBOL } = await import(
  "../src/lib/listings.ts"
);
const { ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL } = await import("../src/lib/market-ids.ts");

const TOKENS_URL = "https://api.sodax.com/v1/swaps/tokens/sonic";
const ROBINHOOD_TOKENS_URL = "https://api.sodax.com/v1/swaps/tokens/robinhood";
const ORACLE_URL = "https://api.sodax.com/v1/intent/oracle";
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
// Any other real world asset the backend flags on Sonic (a second issuer's
// stock, a bond fund) is a question for a person, not drift: said, not failed.
const otherRwa = live.filter(
  (token) => token.isRwa && !pinned.has(lower(token.address)) && !/Robinhood Token$/.test(token.name ?? ""),
);
if (otherRwa.length > 0) {
  console.log(
    `Other real world assets on Sonic, not listed: ${otherRwa.map((token) => `${token.symbol} (${token.name})`).join(", ")}.`,
  );
}

// 1b. The Robinhood Chain twins, where the dividend multiplier is read: the
//     backend's robinhood spoke list names each one, and its vault is the
//     listing on Sonic, so a wrong pin here shows as a mismatch.
const twinsResponse = await fetch(ROBINHOOD_TOKENS_URL, { signal: AbortSignal.timeout(20_000) });
if (twinsResponse.ok) {
  const twins = await twinsResponse.json();
  const twinByVault = new Map(twins.map((token) => [lower(token.vault ?? ""), token]));
  for (const listing of TOKEN_LISTINGS) {
    const twin = twinByVault.get(lower(listing.address));
    const pinnedTwin = ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL[listing.symbol];
    if (!pinnedTwin) note(`${listing.symbol}: no Robinhood Chain address pinned in lib/market-ids`);
    else if (!twin) note(`${listing.symbol}: the backend's robinhood list has no token vaulted as it`);
    else if (lower(twin.address) !== lower(pinnedTwin))
      note(`${listing.symbol}: Robinhood Chain address pinned ${pinnedTwin}, backend serves ${twin.address}`);
  }
} else {
  note(`GET ${ROBINHOOD_TOKENS_URL} answered ${twinsResponse.status}`);
}

// 1b'. The installed SDK's robinhood spoke, which is what a buy delivered to
//      Robinhood Chain is built against: each listing's rhAddress and
//      rhHubAsset (lib/listings) must be the spoke token the SDK knows, and
//      that token must vault into the listing on Sonic.
const spokeTokens = new Sodax().config.getSupportedSwapTokensByChainId("robinhood");
const spokeBySymbol = new Map(spokeTokens.map((token) => [token.symbol, token]));
for (const listing of TOKEN_LISTINGS) {
  const spoke = spokeBySymbol.get(listing.symbol);
  if (!spoke) {
    note(`${listing.symbol}: the SDK's robinhood spoke has no token of this symbol`);
    continue;
  }
  if (!listing.rhAddress || lower(spoke.address) !== lower(listing.rhAddress))
    note(`${listing.symbol}: rhAddress ${listing.rhAddress ?? "missing"}, SDK spoke has ${spoke.address}`);
  if (!listing.rhHubAsset || lower(spoke.hubAsset) !== lower(listing.rhHubAsset))
    note(`${listing.symbol}: rhHubAsset ${listing.rhHubAsset ?? "missing"}, SDK spoke has ${spoke.hubAsset}`);
  if (lower(spoke.vault ?? "") !== lower(listing.address))
    note(`${listing.symbol}: the SDK's robinhood token vaults into ${spoke.vault}, not the listing ${listing.address}`);
  const pinned = ROBINHOOD_CHAIN_ADDRESS_BY_SYMBOL[listing.symbol];
  if (pinned && lower(spoke.address) !== lower(pinned))
    note(`${listing.symbol}: SDK spoke token ${spoke.address}, lib/market-ids pins ${pinned}`);
}

// 1c. The solver oracle, which the board and the portfolio price from.
const oracleResponse = await fetch(ORACLE_URL, { signal: AbortSignal.timeout(20_000) });
if (oracleResponse.ok) {
  const entries = await oracleResponse.json();
  const priced = new Set(
    entries
      .filter((entry) => entry.chainId === "146" && typeof entry.priceUsd === "number" && entry.priceUsd > 0)
      .map((entry) => lower(entry.address ?? "")),
  );
  for (const listing of TOKEN_LISTINGS) {
    if (!priced.has(lower(listing.address))) note(`${listing.symbol}: the solver oracle has no price for it`);
  }
} else {
  note(`GET ${ORACLE_URL} answered ${oracleResponse.status}`);
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

// 2b. Robinhood Chain on chain, not SDK against SDK: the hub asset
//     manager must file each listing's rhHubAsset as Robinhood Chain's
//     (relay chain 21071) spoke token rhAddress, and that token on 4663 must
//     have the listing's decimals. A buy delivered there is built from
//     these two addresses and its quantity read in these decimals.
const ROBINHOOD_RELAY_CHAIN_ID = 21071n;
const ROBINHOOD_RPC = process.env.ROBINHOOD_RPC_URL ?? "https://robinhood-rpc.publicnode.com";
const hubAssetManager = new Sodax().hubProvider.chainConfig.addresses.assetManager;
const rhClient = createPublicClient({ transport: http(ROBINHOOD_RPC) });
const twinReads = await Promise.all(
  TOKEN_LISTINGS.filter((listing) => listing.rhHubAsset && listing.rhAddress).map(async (listing) => {
    try {
      const [[chainId, spokeAddress], decimals] = await Promise.all([
        client.readContract({ address: hubAssetManager, abi: assetManagerAbi, functionName: "assetInfo", args: [listing.rhHubAsset] }),
        rhClient.readContract({ address: listing.rhAddress, abi: erc20, functionName: "decimals" }),
      ]);
      return { listing, chainId, spokeAddress, decimals };
    } catch (error) {
      return { listing, error };
    }
  }),
);
for (const read of twinReads) {
  const { listing } = read;
  if (read.error) {
    note(`${listing.symbol}: Robinhood Chain twin read failed: ${read.error.shortMessage ?? read.error.message}`);
    continue;
  }
  if (read.chainId !== ROBINHOOD_RELAY_CHAIN_ID)
    note(`${listing.symbol}: the asset manager files rhHubAsset under chain ${read.chainId}, not Robinhood Chain`);
  if (lower(read.spokeAddress) !== lower(listing.rhAddress))
    note(`${listing.symbol}: the asset manager maps rhHubAsset to ${read.spokeAddress}, not rhAddress ${listing.rhAddress}`);
  if (Number(read.decimals) !== listing.decimals)
    note(`${listing.symbol}: decimals() on Robinhood Chain is ${read.decimals}`);
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
