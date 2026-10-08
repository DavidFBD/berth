/**
 * Recovery support for a sell from Robinhood Chain that did not fill
 * (review M1, sell; lib/robinhood-returned). Read only: nothing is signed,
 * sent or written.
 *
 * A sell from a wallet on Robinhood Chain deposits the token on 4663 and
 * the relay carries it to Sonic as the listing's hub asset, in the hub
 * wallet derived for (robinhood, that wallet). When the intent expires or
 * is not filled, the token waits there. This prints, for one wallet:
 *
 *   - the hub wallet derived for (robinhood, wallet), and the Berth account's
 *     own, derived for (base, wallet), for comparison
 *   - every listing token and hub asset held by the robinhood one, and the
 *     SDK recovery's own view of it (sodax.recovery.fetchHubAssetBalances)
 *   - the wallet's own listing balances on Robinhood Chain
 *   - with --tx, the unsigned transaction that would bring each hub asset
 *     back to the wallet on Robinhood Chain (sodax.recovery.withdrawHubAsset,
 *     raw). Only the wallet's owner can sign it, on Robinhood Chain, and it
 *     costs a small network fee there in ETH.
 *
 *   pnpm rh:hubwallet 0xWallet
 *   pnpm rh:hubwallet 0xWallet --tx
 */
import "./lib/load-env.mjs";

const address = process.argv.slice(2).find((arg) => /^0x[0-9a-fA-F]{40}$/.test(arg));
const WITH_TX = process.argv.includes("--tx");
if (!address) {
  console.error("Usage: pnpm rh:hubwallet <0x EVM address> [--tx]");
  process.exit(1);
}

const { getAddress, formatUnits } = await import("viem");
const { getSodax } = await import("../src/lib/server/pour-verify.ts");
const { RETURNED_LISTINGS, RETURNED_TOKENS, readReturnedRaw, robinhoodHubWallet } = await import("../src/lib/robinhood-returned.ts");
const { ROBINHOOD_CHAIN_KEY } = await import("../src/lib/robinhood-sell.ts");
const { HOME_CHAIN } = await import("../src/lib/account.ts");
const { readRobinhoodTokenBalances } = await import("../src/lib/server/robinhood-balances.ts");

const owner = getAddress(address);
const sodax = getSodax();
const hub = sodax.hubProvider;
const SONICSCAN = "https://sonicscan.org/address/";

const rhHubWallet = await robinhoodHubWallet(hub, owner);
const homeHubWallet = getAddress(await hub.getUserHubWalletAddress(owner, HOME_CHAIN));
console.log(`Wallet:                            ${owner}`);
console.log(`Hub wallet for (robinhood, wallet): ${rhHubWallet}  ${SONICSCAN}${rhHubWallet}`);
console.log(`Hub wallet for (base, wallet):      ${homeHubWallet}  (the Berth account; not read here)`);

// Every listing token and hub asset at the robinhood hub wallet, one by one.
const tokens = RETURNED_TOKENS;
const raw = await hub.publicClient.multicall({
  allowFailure: true,
  contracts: tokens.map((entry) => ({
    address: entry.token,
    abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [rhHubWallet],
  })),
});
console.log("\nOn Sonic, in the hub wallet for (robinhood, wallet):");
let any = false;
tokens.forEach((entry, index) => {
  const answer = raw[index];
  const listing = RETURNED_LISTINGS.find((candidate) => candidate.symbol === entry.symbol);
  const kind = listing && entry.token.toLowerCase() === listing.rhHubAsset.toLowerCase() ? "hub asset" : "Sonic token";
  if (answer.status !== "success") {
    console.log(`  ${entry.symbol.padEnd(6)} ${kind.padEnd(11)} ${entry.token}  UNREAD`);
    any = true;
    return;
  }
  if (answer.result > 0n) {
    console.log(`  ${entry.symbol.padEnd(6)} ${kind.padEnd(11)} ${entry.token}  ${formatUnits(answer.result, 18)}`);
    any = true;
  }
});
if (!any) console.log("  nothing");
// The shared reader's sum, as Berth counts it (lib/robinhood-returned).
const [summed] = await readReturnedRaw(hub.publicClient, [rhHubWallet]);
if (summed.size > 0) {
  console.log("  as Berth counts it: " + [...summed].map(([symbol, amount]) => `${formatUnits(amount, 18)} ${symbol}`).join(", "));
}

const recovery = await sodax.recovery.fetchHubAssetBalances({ chainKey: ROBINHOOD_CHAIN_KEY, srcAddress: owner });
console.log("\nThe SDK recovery's view (every robinhood hub asset):");
if (!recovery.ok) console.log("  could not read:", recovery.error?.message ?? recovery.error);
else if (recovery.value.length === 0) console.log("  nothing");
else for (const entry of recovery.value) console.log(`  ${entry.symbol.padEnd(6)} ${entry.hubAssetAddress}  ${formatUnits(entry.balance, entry.decimal)}`);

const onChain = await readRobinhoodTokenBalances(RETURNED_LISTINGS.map((listing) => ({ holder: owner, token: listing.rhAddress })));
console.log("\nOn Robinhood Chain, in the wallet itself:");
let held = false;
RETURNED_LISTINGS.forEach((listing, index) => {
  const balance = onChain[index];
  if (typeof balance !== "bigint") {
    console.log(`  ${listing.symbol.padEnd(6)} ${listing.rhAddress}  ${balance === null ? "UNREAD" : "reverted"}`);
    held = true;
  } else if (balance > 0n) {
    console.log(`  ${listing.symbol.padEnd(6)} ${listing.rhAddress}  ${formatUnits(balance, listing.decimals)}`);
    held = true;
  }
});
if (!held) console.log("  nothing");

if (WITH_TX && recovery.ok) {
  console.log("\nUnsigned recovery transactions (sign on Robinhood Chain with the wallet itself):");
  if (recovery.value.length === 0) console.log("  none needed");
  for (const entry of recovery.value) {
    const tx = await sodax.recovery.withdrawHubAsset({
      raw: true,
      params: { srcChainKey: ROBINHOOD_CHAIN_KEY, srcAddress: owner, token: entry.spokeTokenAddress, amount: entry.balance },
    });
    console.log(`  ${entry.symbol}:`, tx.ok ? JSON.stringify(tx.value, (_key, value) => (typeof value === "bigint" ? value.toString() : value)) : tx.error);
  }
}
process.exit(0);
