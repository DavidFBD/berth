import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { TOKEN_LISTINGS, type Listing } from "./listings";
import { heldOnly, mergeChainHoldings, placeReturnedTotals, placeRobinhoodTotals, robinhoodOwners, robinhoodReadPlan } from "./account-holdings";

const NVDA = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
const AAPL = TOKEN_LISTINGS.find((listing) => listing.symbol === "AAPL")!;
const SGOV = TOKEN_LISTINGS.find((listing) => listing.kind === "cash")!;
const LISTINGS: Listing[] = [NVDA, AAPL, SGOV];
const WALLET = "0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23";
const OTHER = "0x1111111111111111111111111111111111111111";

describe("mergeChainHoldings", () => {
  const hub = [
    { listing: NVDA, balance: 2n },
    { listing: AAPL, balance: 0n },
    { listing: SGOV, balance: 5n },
  ];

  it("is the hub exactly when Robinhood Chain is not read (off, loading or failed)", () => {
    const merged = mergeChainHoldings(hub, undefined);
    expect(merged.map((row) => row.balance)).toEqual([2n, 0n, 5n]);
    expect(merged.map((row) => row.hub)).toEqual([2n, 0n, 5n]);
    expect(merged.every((row) => row.robinhood === 0n)).toBe(true);
  });

  it("sums the two chains per listing and keeps each part", () => {
    const merged = mergeChainHoldings(hub, [3n, 7n, 0n]);
    expect(merged.map((row) => [row.balance, row.hub, row.robinhood])).toEqual([
      [5n, 2n, 3n],
      [7n, 0n, 7n],
      [5n, 5n, 0n],
    ]);
  });

  it("never raises what a sell may spend: `hub` stays the hub read whatever sits on Robinhood Chain", () => {
    const merged = mergeChainHoldings(hub, [10n ** 18n, 10n ** 18n, 0n]);
    expect(merged.map((row) => row.hub)).toEqual(hub.map((row) => row.balance));
  });

  it("drops a listing held on neither chain, and keeps one held only on Robinhood Chain", () => {
    const held = heldOnly(mergeChainHoldings(hub, [0n, 4n, 0n]));
    expect(held.map((row) => row.listing.symbol)).toEqual(["NVDA", "AAPL", SGOV.symbol]);
    expect(heldOnly(mergeChainHoldings(hub, [0n, 0n, 0n])).map((row) => row.listing.symbol)).toEqual(["NVDA", SGOV.symbol]);
  });
});

describe("what came back to Sonic from a sell from Robinhood Chain (review M1, sell)", () => {
  const hub = [
    { listing: NVDA, balance: 2n },
    { listing: AAPL, balance: 0n },
    { listing: SGOV, balance: 5n },
  ];

  it("counts in the balance and is shown, but never in what a sell may spend", () => {
    const merged = mergeChainHoldings(hub, [3n, 0n, 0n], [4n, 6n, 0n]);
    expect(merged.map((row) => [row.balance, row.hub, row.robinhood, row.returned, row.sellable])).toEqual([
      [9n, 2n, 3n, 4n, 5n],
      [6n, 0n, 0n, 6n, 0n],
      [5n, 5n, 0n, 0n, 5n],
    ]);
    // Held only as returned: listed, with nothing a sell can spend.
    expect(heldOnly(merged).map((row) => row.listing.symbol)).toContain("AAPL");
  });

  it("is zero when not read", () => {
    expect(mergeChainHoldings(hub, undefined).every((row) => row.returned === 0n && row.sellable === row.hub)).toBe(true);
  });

  it("is placed at the stock listings by symbol, never at cash", () => {
    const total = new Map([
      ["AAPL", 7n],
      [SGOV.symbol, 9n],
    ]);
    expect(placeReturnedTotals(LISTINGS, total)).toEqual([0n, 7n, 0n]);
  });
});

describe("robinhoodReadPlan", () => {
  const account = { wallets: [{ spoke: WALLET }], signerSpoke: WALLET };

  it("plans a read for any account with an EVM wallet, whatever the delivery switch says, so turning it off never hides what was delivered", () => {
    expect(robinhoodReadPlan({ account, listings: LISTINGS })?.owners).toEqual([getAddress(WALLET)]);
  });

  it("plans nothing without an EVM wallet", () => {
    expect(robinhoodReadPlan({ account: { wallets: [{ spoke: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" }] }, listings: LISTINGS })).toBeNull();
  });

  it("reads every linked EVM wallet once, checksummed, for the stocks with a Robinhood Chain token", () => {
    const plan = robinhoodReadPlan({
      account: { wallets: [{ spoke: WALLET }, { spoke: OTHER }], signerSpoke: getAddress(WALLET) },
      listings: LISTINGS,
    });
    expect(plan?.owners).toEqual([getAddress(WALLET), getAddress(OTHER)]);
    // Cash is parked and unparked on the hub; only stocks are read there.
    expect(plan?.tokens).toEqual([
      { rhAddress: NVDA.rhAddress, index: 0 },
      { rhAddress: AAPL.rhAddress, index: 1 },
    ]);
  });

  it("places the totals back at their listings", () => {
    const plan = robinhoodReadPlan({ account, listings: LISTINGS })!;
    expect(placeRobinhoodTotals(plan, [9n, 8n], LISTINGS.length)).toEqual([9n, 8n, 0n]);
  });

  it("robinhoodOwners leaves out what is not an EVM address", () => {
    expect(robinhoodOwners({ wallets: [{ spoke: "bc1qxyz" }, { spoke: WALLET }] })).toEqual([getAddress(WALLET)]);
  });
});

describe("what spends is one place, never the sum", () => {
  // A sell spends one place at a time (plan P3a): a hub wallet, or one
  // wallet on Robinhood Chain. A limit sell, the cash shelf and the
  // assistant's per place cap never spend the two-chain sum, so none may
  // read the summed holdings to size an order.
  const spenders = [
    "src/components/flow/withdraw-drawer.tsx",
    "src/components/account-wallets.tsx",
    "src/components/board/cash-shelf.tsx",
    "src/lib/server/berth-tools/registry.ts",
  ];
  it.each(spenders)("%s does not read the two-chain holdings", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toContain("use-account-holdings");
    expect(source).not.toContain("useAccountHoldings");
  });

  it("the home's sell drawer reads each place on its own, never the sum", () => {
    const source = readFileSync("src/components/home.tsx", "utf8");
    const sellDrawer = source.slice(source.indexOf("function SellHost"));
    expect(sellDrawer.slice(0, 3000)).toContain("useHubHoldings(account.hubWallets)");
    expect(sellDrawer.slice(0, 3000)).toContain("useRobinhoodSellBalances(listing, account, open && sellFromWallet)");
    expect(sellDrawer.slice(0, 3000)).not.toContain("useAccountHoldings");
  });

  it("a draft sell opens for a holding in either place, and the sheet sizes it per place", () => {
    const home = readFileSync("src/components/home.tsx", "utf8");
    // Only what a sell can spend: never what came back to Sonic from a sell there.
    expect(home).toContain("heldAddresses: ownedHoldings.held.filter((holding) => holding.sellable > 0n)");
    const opener = readFileSync("src/components/assistant/draft-link-opener.tsx", "utf8");
    expect(opener).toContain("useAccountHoldings(account, hub)");
    expect(opener).toContain("holdings.held.filter((holding) => holding.sellable > 0n)");
    // Only whether to open; the amount is capped by the chosen place in the sheet.
    expect(opener).not.toContain("availableShares");
  });
});
