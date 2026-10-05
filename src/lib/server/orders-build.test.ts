import { EvmSolverService, Sodax, type Intent } from "@sodax/sdk";
import { encodeAbiParameters } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INTENT_FILLED_TOPIC, TRANSFER_TOPIC, addressTopic } from "@/lib/orders";
import { TOKEN_LISTINGS } from "@/lib/listings";

/**
 * buildOrder's fill reading, with the hub reads stubbed: a hub buy is read
 * from the listing's Transfer to the hub wallet, a Robinhood Chain buy from
 * the Intents contract's IntentFilled for its own hash, since its output
 * leaves Sonic through the asset manager and never reaches the buyer there.
 */

const calls: { method: string; params: unknown[] }[] = [];
let answers: Record<string, unknown> = {};

vi.mock("@/lib/server/hub-rpc", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/hub-rpc")>();
  return {
    ...real,
    hubRpc: async (method: string, params: unknown[]) => {
      calls.push({ method, params });
      return { ok: true, result: answers[method] ?? null };
    },
  };
});

const { buildOrder } = await import("./orders");

const sodax = new Sodax();
const NVDA = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
const USDC_BASE_HUB = "0x72E852545B024ddCbc5b70C1bCBDAA025164259C" as const;
const BUYER = "0x1111111111111111111111111111111111111111";
const HUB_WALLET = "0x2222222222222222222222222222222222222222";

const intent = (over: Partial<Intent>): Intent =>
  ({
    intentId: 1n,
    creator: HUB_WALLET,
    inputToken: USDC_BASE_HUB,
    outputToken: NVDA.address,
    inputAmount: 4_980_000n,
    minOutputAmount: 10n ** 16n,
    deadline: 0n,
    allowPartialFill: false,
    srcChain: 30n,
    dstChain: 146n,
    srcAddress: BUYER,
    dstAddress: HUB_WALLET,
    solver: "0x0000000000000000000000000000000000000000",
    data: "0x",
    ...over,
  }) as Intent;

const filledLog = (hash: string, received: bigint) => ({
  transactionHash: "0xF1LL",
  blockNumber: "0x20",
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
    [hash as `0x${string}`, { exists: true, remainingInput: 0n, receivedOutput: received, pendingPayment: false }],
  ),
});

beforeEach(() => {
  calls.length = 0;
  answers = {
    eth_getTransactionReceipt: { blockNumber: "0x10" },
    eth_getBlockByNumber: { timestamp: "0x6700a000" },
  };
});

describe("buildOrder", () => {
  it("reads a Robinhood Chain buy's fill from IntentFilled, holding it on robinhood under the Sonic listing", async () => {
    const rh = intent({ outputToken: NVDA.rhHubAsset!, dstChain: 21071n, dstAddress: BUYER });
    answers.eth_getLogs = [filledLog(`0x${"00".repeat(32)}`, 5n), filledLog(EvmSolverService.getIntentHash(rh), 12_340_000_000_000_000n)];
    const order = await buildOrder({ sodax, intentTx: "0xABC", direction: "buy", intent: rh });
    expect(order).toBeDefined();
    expect(order!.holdingChain).toBe("robinhood");
    expect(order!.listingSymbol).toBe("NVDA");
    expect(order!.listingAddress).toBe(NVDA.address.toLowerCase());
    expect(order!.deliveredTo).toBe(BUYER);
    expect(order!.quantity).toBe("0.01234");
    expect(order!.fillTx).toBe("0xf1ll");
    const search = calls.find((call) => call.method === "eth_getLogs")!.params[0] as { address: string; topics: string[] };
    expect(search.address.toLowerCase()).toBe(sodax.config.solver.intentsContract.toLowerCase());
    expect(search.topics).toEqual([INTENT_FILLED_TOPIC]);
  });

  it("reads a hub buy from the listing's Transfer to the hub wallet, as before", async () => {
    answers.eth_getLogs = [{ transactionHash: "0xT", blockNumber: "0x20", data: "0x2a" }];
    const order = await buildOrder({ sodax, intentTx: "0xDEF", direction: "buy", intent: intent({}) });
    expect(order!.holdingChain).toBe("sonic");
    expect(order!.quantity).toBe("0.000000000000000042");
    const search = calls.find((call) => call.method === "eth_getLogs")!.params[0] as { address: string; topics: (string | null)[] };
    expect(search.address).toBe(NVDA.address);
    expect(search.topics).toEqual([TRANSFER_TOPIC, null, addressTopic(HUB_WALLET)]);
  });

  it("builds nothing for a hub asset delivered to the hub, which no listing holds", async () => {
    expect(await buildOrder({ sodax, intentTx: "0x1", direction: "buy", intent: intent({ outputToken: NVDA.rhHubAsset! }) })).toBeUndefined();
  });
});
