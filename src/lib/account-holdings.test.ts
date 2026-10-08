import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { TOKEN_LISTINGS, type Listing } from "./listings";
import { heldOnly, mergeChainHoldings, placeRobinhoodTotals, robinhoodOwners, robinhoodReadPlan } from "./account-holdings";

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

describe("what spends stays on the hub", () => {
  // A sell, a limit sell, their Max and the assistant's sell cap spend the
  // hub alone; none may read the two-chain holdings (plan, carried into P1).
  const spenders = [
    "src/components/flow/withdraw-drawer.tsx",
    "src/components/assistant/draft-link-opener.tsx",
    "src/components/account-wallets.tsx",
    "src/components/board/cash-shelf.tsx",
    "src/lib/server/berth-tools/registry.ts",
  ];
  it.each(spenders)("%s does not read the two-chain holdings", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toContain("use-account-holdings");
    expect(source).not.toContain("useAccountHoldings");
  });

  it("the home's sell drawer and draft sells read the hub", () => {
    const source = readFileSync("src/components/home.tsx", "utf8");
    const sellDrawer = source.slice(source.indexOf("function SellHost"));
    expect(sellDrawer.slice(0, 1500)).toContain("useHubHoldings(account.hubWallets)");
    expect(sellDrawer.slice(0, 1500)).not.toContain("useAccountHoldings");
    expect(source).toContain("heldAddresses: holdings.held.map");
  });
});
