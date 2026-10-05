import { describe, expect, it } from "vitest";
import { IntentFilledEventAbi, Sodax, robinhoodSupportedTokens } from "@sodax/sdk";
import { encodeAbiParameters, toEventSelector } from "viem";
import {
  INTENT_FILLED_TOPIC,
  ROBINHOOD_RELAY_CHAIN_ID,
  SONIC_RELAY_CHAIN_ID,
  addressTopic,
  decodeFee,
  holdingChainOf,
  isDollarStable,
  listingOfIntent,
  pickFill,
  pickIntentFill,
  priceIdFor,
  readOrder,
} from "@/lib/orders";

/** A real Cash buy from 2026-09-21: 2 USDC from BNB Chain, 0.4% partner fee. */
const CASH_BUY = {
  inputToken: "0x9D58508AD10d34048a11640735Ca5075bbA07b35",
  outputToken: "0xf6938087cf794B08739b926B41FF8F1E90816E74",
  inputAmount: 1_992_000_000_000_000_000n,
  minOutputAmount: 18_739_690_511_261_211n,
  srcAddress: "0xbe59d5bf40ac4a349bd748e0d7c19ef27ad3ca23",
  srcChain: 4n,
  dstChain: 146n,
  data: "0x01000000000000000000000000000000000000000000000000001c6bf526340000000000000000000000000000be59d5bf40ac4a349bd748e0d7c19ef27ad3ca23",
};
const CASH = { symbol: "SGOV", address: CASH_BUY.outputToken, decimals: 18 };
const USDC_BSC = { symbol: "USDC", decimals: 18, chainKey: "0x38.bsc" };

describe("decodeFee", () => {
  it("reads the partner fee the intent carries", () => {
    expect(decodeFee(CASH_BUY.data)).toBe(8_000_000_000_000_000n);
  });

  it("is zero for anything that is not a fee payload", () => {
    expect(decodeFee("0x")).toBe(0n);
    expect(decodeFee("0x02" + "00".repeat(64))).toBe(0n);
  });
});

describe("readOrder", () => {
  it("reads a buy as what was paid, fee included, and what arrived", () => {
    const order = readOrder({
      intentTx: "0xABC",
      direction: "buy",
      intent: CASH_BUY,
      listing: CASH,
      pay: USDC_BSC,
      received: 18_910_160_738_976_805n,
      fillTx: "0xFILL",
    });
    expect(order).toMatchObject({
      intentTx: "0xabc",
      fillTx: "0xfill",
      listingSymbol: "SGOV",
      quantity: "0.018910160738976805",
      minQuantity: "0.018739690511261211",
      paySymbol: "USDC",
      payAmount: "2",
      feeAmount: "0.008",
      usdValue: "2",
      walletAddress: CASH_BUY.srcAddress,
    });
  });

  it("records where the buy was delivered, lowercased, and null when unknown", () => {
    const hub = "0xAbCdEf0000000000000000000000000000000001";
    const order = readOrder({
      intentTx: "0x1",
      direction: "buy",
      intent: { ...CASH_BUY, dstAddress: hub },
      listing: CASH,
      pay: USDC_BSC,
    });
    expect(order.deliveredTo).toBe(hub.toLowerCase());
    expect(
      readOrder({ intentTx: "0x1", direction: "buy", intent: CASH_BUY, listing: CASH, pay: USDC_BSC })
        .deliveredTo,
    ).toBeNull();
    const solana = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    expect(
      readOrder({ intentTx: "0x1", direction: "buy", intent: { ...CASH_BUY, dstAddress: solana }, listing: CASH, pay: USDC_BSC })
        .deliveredTo,
    ).toBe(solana);
  });

  it("leaves the quantity unknown until the fill is found", () => {
    const order = readOrder({ intentTx: "0x1", direction: "buy", intent: CASH_BUY, listing: CASH, pay: USDC_BSC });
    expect(order.quantity).toBeNull();
    expect(order.fillTx).toBeNull();
  });

  it("prices a buy paid in a coin at that coin's price at the order", () => {
    // The real SpaceX buy: 146.73 KAIA at 0.03186 dollars each.
    const order = readOrder({
      intentTx: "0x1",
      direction: "buy",
      intent: { ...CASH_BUY, inputAmount: 146_140_000_000_000_000_000n },
      listing: CASH,
      pay: { symbol: "KAIA", decimals: 18, chainKey: "kaia" },
      payUsdPrice: 0.03186,
    });
    expect(order.usdSource).toBe("price");
    expect(Number(order.usdValue)).toBeCloseTo(146.148 * 0.03186, 4);
  });

  it("marks a stablecoin's dollars as exact", () => {
    const order = readOrder({ intentTx: "0x1", direction: "buy", intent: CASH_BUY, listing: CASH, pay: USDC_BSC });
    expect(order.usdSource).toBe("stable");
  });

  it("never puts a dollar figure on a buy paid in something that is not a dollar", () => {
    const order = readOrder({
      intentTx: "0x1",
      direction: "buy",
      intent: CASH_BUY,
      listing: CASH,
      pay: { symbol: "ETH", decimals: 18, chainKey: "0x1.ethereum" },
    });
    expect(order.usdValue).toBeNull();
    expect(order.payAmount).toBe("2");
  });

  it("reads a sell as the quantity spent and leaves the proceeds unknown", () => {
    const sell = { ...CASH_BUY, inputToken: CASH.address, outputToken: CASH_BUY.inputToken, data: "0x" };
    const order = readOrder({ intentTx: "0x1", direction: "sell", intent: sell, listing: CASH, pay: USDC_BSC });
    expect(order.quantity).toBe("1.992");
    expect(order.usdValue).toBeNull();
  });

  it("keeps no wallet for a source that is not an EVM address", () => {
    const solana = { ...CASH_BUY, srcAddress: "ESWQm8aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4BDD" };
    expect(readOrder({ intentTx: "0x1", direction: "buy", intent: solana, listing: CASH, pay: USDC_BSC }).walletAddress).toBeNull();
  });
});

describe("pickFill", () => {
  const log = (hash: string, block: number, value: bigint) => ({
    transactionHash: hash,
    blockNumber: `0x${block.toString(16)}`,
    data: `0x${value.toString(16)}`,
  });

  it("takes the first transfer after the intent", () => {
    expect(pickFill([log("0xB", 20, 2n), log("0xA", 10, 1n)])).toEqual({ fillTx: "0xa", received: 1n, blockNumber: 10 });
  });

  it("takes the fill the client named when it is among them", () => {
    expect(pickFill([log("0xA", 10, 1n), log("0xB", 20, 2n)], "0xb")?.received).toBe(2n);
  });

  it("ignores a named fill that is not among them", () => {
    expect(pickFill([log("0xA", 10, 1n)], "0xdead")?.fillTx).toBe("0xa");
  });

  it("finds nothing in nothing", () => {
    expect(pickFill([])).toBeUndefined();
  });
});

describe("helpers", () => {
  it("pads an address into a log topic", () => {
    expect(addressTopic("0x34CB1d8453553e65e0596b076a7eedd08b8069fc")).toBe(
      "0x00000000000000000000000034cb1d8453553e65e0596b076a7eedd08b8069fc",
    );
  });

  it("finds a price id for a native coin, then in the app's own list", () => {
    expect(priceIdFor("KAIA")).toBe("kaia");
    expect(priceIdFor("aave", { aave: "aave" })).toBe("aave");
    expect(priceIdFor("NOPE")).toBeUndefined();
    expect(priceIdFor("sodaBTC")).toBe("bitcoin");
    expect(priceIdFor("sodaETH")).toBeUndefined();
    expect(priceIdFor("soda")).toBeUndefined();
  });

  it("counts only dollar stablecoins as dollars", () => {
    expect(isDollarStable("usdc")).toBe(true);
    expect(isDollarStable("ETH")).toBe(false);
    expect(isDollarStable(null)).toBe(false);
  });
});

/** NVDA on both chains (@sodax/sdk 2.2.0-rc.8 robinhoodSupportedTokens). */
const NVDA = {
  symbol: "NVDA",
  address: "0x2D5D2250EE426cA318efBd03ddf926B23c96f74B",
  decimals: 18,
  rhHubAsset: "0xa754bf15f0289b539aae5ce1a453e28898b7704e",
};
const BUYER = "0x1111111111111111111111111111111111111111";
const RH_BUY = { ...CASH_BUY, outputToken: NVDA.rhHubAsset, dstChain: 21071n, dstAddress: BUYER };

describe("the chain an order's stock token sits on", () => {
  it("pins the relay ids the SDK maps to the hub and Robinhood Chain", () => {
    const config = new Sodax().config;
    expect(config.getSpokeChainKeyFromIntentRelayChainId(ROBINHOOD_RELAY_CHAIN_ID as never)).toBe("robinhood");
    expect(config.getSpokeChainKeyFromIntentRelayChainId(SONIC_RELAY_CHAIN_ID as never)).toBe("sonic");
  });

  it("reads a buy's destination and a sell's source, and calls everything else the hub", () => {
    expect(holdingChainOf("buy", { dstChain: 21071n })).toBe("robinhood");
    expect(holdingChainOf("buy", { dstChain: "21071" })).toBe("robinhood");
    expect(holdingChainOf("buy", { dstChain: 146n, srcChain: 21071n })).toBe("sonic");
    expect(holdingChainOf("sell", { srcChain: 21071, dstChain: 146 })).toBe("robinhood");
    expect(holdingChainOf("sell", { srcChain: 146n, dstChain: 21071n })).toBe("sonic");
    expect(holdingChainOf("buy", {})).toBe("sonic");
  });

  it("writes it on every record readOrder makes, and keeps the Sonic listing address for a Robinhood Chain buy", () => {
    const hub = readOrder({ intentTx: "0x1", direction: "buy", intent: CASH_BUY, listing: CASH, pay: USDC_BSC });
    expect(hub.holdingChain).toBe("sonic");
    const rh = readOrder({ intentTx: "0x2", direction: "buy", intent: RH_BUY, listing: NVDA, pay: USDC_BSC, received: 10n ** 16n });
    expect(rh.holdingChain).toBe("robinhood");
    expect(rh.listingAddress).toBe(NVDA.address.toLowerCase());
    expect(rh.deliveredTo).toBe(BUYER);
    expect(rh.quantity).toBe("0.01");
  });
});

describe("listingOfIntent", () => {
  const listings = [NVDA, { ...CASH, rhHubAsset: "0x9999999999999999999999999999999999999999" }];

  it("finds a hub buy by its Sonic address and a Robinhood Chain buy by its hub asset there", () => {
    expect(listingOfIntent(listings, { ...CASH_BUY, outputToken: NVDA.address }, "buy")).toBe(NVDA);
    expect(listingOfIntent(listings, RH_BUY, "buy")).toBe(NVDA);
    expect(listingOfIntent(listings, { ...RH_BUY, outputToken: NVDA.rhHubAsset.toUpperCase().replace("0X", "0x") }, "buy")).toBe(NVDA);
  });

  it("refuses a token on the wrong chain: the hub asset delivered to the hub, the Sonic listing sent to Robinhood Chain", () => {
    expect(listingOfIntent(listings, { ...RH_BUY, dstChain: 146n }, "buy")).toBeUndefined();
    expect(listingOfIntent(listings, { ...RH_BUY, outputToken: NVDA.address }, "buy")).toBeUndefined();
  });

  it("reads a sell from its input on the hub, and no sell from Robinhood Chain until P3a", () => {
    const sell = { ...CASH_BUY, inputToken: NVDA.rhHubAsset, outputToken: CASH_BUY.inputToken, srcChain: 21071n, dstChain: 4n };
    expect(listingOfIntent(listings, sell, "sell")).toBeUndefined();
    expect(listingOfIntent(listings, { ...sell, inputToken: NVDA.address }, "sell")).toBeUndefined();
    expect(listingOfIntent(listings, { ...sell, inputToken: NVDA.address, srcChain: 146n }, "sell")).toBe(NVDA);
    expect(listingOfIntent(listings, { ...sell, srcChain: 146n }, "sell")).toBeUndefined();
  });

  it("knows every SDK Robinhood Chain stock token as the listing it vaults into", () => {
    const spoke = robinhoodSupportedTokens as Record<string, { hubAsset: string; vault: string }>;
    const nvda = spoke.NVDA;
    expect(nvda.hubAsset.toLowerCase()).toBe(NVDA.rhHubAsset);
    expect(nvda.vault).toBe(NVDA.address);
  });
});

describe("pickIntentFill", () => {
  const HASH = `0x${"ab".repeat(32)}`;
  const OTHER = `0x${"cd".repeat(32)}`;
  const filled = (tx: string, block: number, hash: string, remaining: bigint, received: bigint) => ({
    transactionHash: tx,
    blockNumber: `0x${block.toString(16)}`,
    topics: [INTENT_FILLED_TOPIC],
    data: encodeAbiParameters(
      [
        { type: "bytes32" },
        {
          type: "tuple",
          components: [
            { name: "exists", type: "bool" },
            { name: "remainingInput", type: "uint256" },
            { name: "receivedOutput", type: "uint256" },
            { name: "pendingPayment", type: "bool" },
          ],
        },
      ],
      [hash as `0x${string}`, { exists: true, remainingInput: remaining, receivedOutput: received, pendingPayment: false }],
    ),
  });

  it("is the topic of the SDK's IntentFilled event", () => {
    expect(INTENT_FILLED_TOPIC).toBe(toEventSelector(IntentFilledEventAbi as never));
  });

  it("keeps only this intent's fills and takes the whole one, its output counted cumulatively", () => {
    const logs = [filled("0xOTHER", 5, OTHER, 0n, 99n), filled("0xB", 12, HASH, 0n, 30n), filled("0xA", 10, HASH, 5n, 10n)];
    expect(pickIntentFill(logs, HASH)).toEqual({ fillTx: "0xb", received: 30n, blockNumber: 12 });
  });

  it("takes the last part fill when none is whole, and nothing when none is this intent's", () => {
    expect(pickIntentFill([filled("0xA", 10, HASH, 5n, 10n), filled("0xC", 11, HASH, 2n, 20n)], HASH)?.fillTx).toBe("0xc");
    expect(pickIntentFill([filled("0xA", 10, OTHER, 0n, 10n)], HASH)).toBeUndefined();
  });

  it("skips a log it cannot read", () => {
    expect(pickIntentFill([{ transactionHash: "0xa", blockNumber: "0x1", data: "0x1234" }], HASH)).toBeUndefined();
  });
});
