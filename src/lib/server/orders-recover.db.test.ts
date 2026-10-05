import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Intent, IntentResponse, Sodax } from "@sodax/sdk";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { berthFilledIntents, recoverAccountOrders, recoverOrders, type RecoveryDeps } from "./orders-recover";
import { decodeFeeReceiver, readOrder } from "@/lib/orders";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { PARTNER_FEE } from "@/lib/sodax-config";

const SGOV = TOKEN_LISTINGS.find((listing) => listing.symbol === "SGOV")!;
const NVDA = TOKEN_LISTINGS.find((listing) => listing.symbol === "NVDA")!;
const USDC_HUB = "0x29219dd400f2bf60e5a23d13be72b486d4038894";
const EOA = "0x1111111111111111111111111111111111111111";
const HUB = "0x2222222222222222222222222222222222222222";
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const feeData = (receiver: string, fee = 1000n) =>
  `0x01${fee.toString(16).padStart(64, "0")}${receiver.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

type Over = { txHash: string; input: string; output: string; src?: string; data?: string; open?: boolean; events?: unknown[] };
const filled = (fillTx: string) => [
  { eventType: "intent-filled", txHash: fillTx, intentState: { exists: true, remainingInput: "0", receivedOutput: "5", pendingPayment: false } },
];
function item({ txHash, input, output, src = EOA, data = feeData(PARTNER_FEE.address), open = false, events }: Over): IntentResponse {
  return {
    intentHash: `0x${"ab".repeat(32)}`,
    txHash,
    logIndex: 0,
    chainId: 146,
    blockNumber: 1,
    open,
    intent: {
      intentId: "1",
      creator: src,
      inputToken: input,
      outputToken: output,
      inputAmount: "18877516067000000",
      minOutputAmount: "600000",
      deadline: "1790328218",
      allowPartialFill: false,
      srcChain: 146,
      dstChain: 8453,
      srcAddress: src,
      dstAddress: EOA,
      solver: "0x0000000000000000000000000000000000000000",
      data,
    },
    events: events ?? filled(tx(9000 + Number.parseInt(txHash.slice(-4), 16))),
  };
}

const asIntent = (response: IntentResponse): Intent =>
  ({
    ...response.intent,
    inputAmount: BigInt(response.intent.inputAmount),
    minOutputAmount: BigInt(response.intent.minOutputAmount),
  }) as unknown as Intent;

function depsFor(items: IntentResponse[], over: Partial<RecoveryDeps> = {}): RecoveryDeps {
  const byTx = new Map(items.map((entry) => [entry.txHash.toLowerCase(), entry]));
  return {
    fetchIntents: vi.fn(async (address: string) => (address === EOA ? items.filter((entry) => entry.intent.srcAddress === EOA) : address === HUB ? items.filter((entry) => entry.intent.srcAddress === HUB) : [])),
    hubOf: vi.fn(async (address: string) => (address === EOA ? HUB : null)),
    verify: vi.fn(async ({ txHash }) => ({ ok: true as const, intent: asIntent(byTx.get(txHash)!), sodax: {} as Sodax })),
    fillOnChain: vi.fn(async () => ({ ok: true, filledAt: new Date("2026-09-25T09:19:30Z") })),
    build: vi.fn(async ({ intentTx, direction, intent }) => {
      const listing = direction === "buy" ? (TOKEN_LISTINGS.find((entry) => entry.address.toLowerCase() === intent.outputToken.toLowerCase())!) : SGOV;
      return readOrder({
        intentTx,
        direction,
        intent,
        listing: { symbol: listing.symbol, address: listing.address, decimals: listing.decimals },
        pay: { symbol: "USDC", decimals: 6, chainKey: "0x2105.base" },
        received: direction === "buy" ? 5n * 10n ** 15n : undefined,
        placedAt: new Date("2026-09-25T09:19:00Z"),
      });
    }),
    marks: vi.fn(async () => 5),
    ...over,
  };
}

describe("decodeFeeReceiver", () => {
  it("reads the receiver from a fee's data, and nothing from data without a fee", () => {
    expect(decodeFeeReceiver(feeData(PARTNER_FEE.address))).toBe(PARTNER_FEE.address.toLowerCase());
    expect(decodeFeeReceiver("0x")).toBeNull();
    expect(decodeFeeReceiver(`0x02${"00".repeat(64)}`)).toBeNull();
  });
});

describe("berthFilledIntents", () => {
  const listings = TOKEN_LISTINGS;
  it("keeps a filled listing order that paid Berth's fee and nothing else", () => {
    const kept = berthFilledIntents(
      [
        item({ txHash: tx(1), input: SGOV.address, output: USDC_HUB, src: HUB }),
        item({ txHash: tx(2), input: USDC_HUB, output: NVDA.address }),
        item({ txHash: tx(3), input: USDC_HUB, output: NVDA.address, data: feeData("0xd3a2fd7cb85e9e759f8ca8658f73640ff7f049d4") }),
        item({ txHash: tx(4), input: USDC_HUB, output: NVDA.address, data: "0x" }),
        item({ txHash: tx(5), input: USDC_HUB, output: "0x9d58508ad10d34048a11640735ca5075bba07b35" }),
        item({ txHash: tx(6), input: USDC_HUB, output: NVDA.address, events: [{ eventType: "intent-cancelled", txHash: tx(66) }] }),
        item({ txHash: tx(7), input: USDC_HUB, output: NVDA.address, open: true, events: [] }),
      ],
      listings,
    );
    expect(kept.map((entry) => [entry.intentTx, entry.direction])).toEqual([
      [tx(1), "sell"],
      [tx(2), "buy"],
    ]);
  });

  it("keeps a buy delivered on Robinhood Chain by its hub asset there, and only on that chain", () => {
    const rh = item({ txHash: tx(8), input: USDC_HUB, output: NVDA.rhHubAsset! });
    const kept = berthFilledIntents(
      [{ ...rh, intent: { ...rh.intent, dstChain: 21071 } }, item({ txHash: tx(9), input: USDC_HUB, output: NVDA.rhHubAsset! })],
      listings,
    );
    expect(kept.map((entry) => [entry.intentTx, entry.direction])).toEqual([[tx(8), "buy"]]);
  });

  it("passes by a sell paid from Robinhood Chain, as on master (until P3a)", () => {
    const sell = item({ txHash: tx(10), input: NVDA.rhHubAsset!, output: USDC_HUB });
    expect(berthFilledIntents([{ ...sell, intent: { ...sell.intent, srcChain: 21071 } }], listings)).toEqual([]);
  });
});

let sql: SqlClient;
let close: () => Promise<void>;
beforeAll(async () => {
  const db = await makeTestDb();
  sql = db.sql;
  close = db.close;
  setSqlClient(sql);
});
afterAll(async () => {
  setSqlClient(null);
  await close();
});

describe("recovering orders", () => {
  const sell = item({ txHash: tx(0x101), input: SGOV.address, output: USDC_HUB, src: HUB });
  const recordedBuy = item({ txHash: tx(0x102), input: USDC_HUB, output: SGOV.address });
  const foreign = item({ txHash: tx(0x103), input: USDC_HUB, output: NVDA.address, data: feeData("0xd3a2fd7cb85e9e759f8ca8658f73640ff7f049d4") });
  const cancelled = item({ txHash: tx(0x104), input: SGOV.address, output: USDC_HUB, src: HUB, events: [{ eventType: "intent-cancelled", txHash: tx(0x904) }] });
  const waiting = item({ txHash: tx(0x105), input: USDC_HUB, output: NVDA.address, open: true, events: [] });
  const notOnChain = item({ txHash: tx(0x106), input: USDC_HUB, output: NVDA.address });
  const items = [sell, recordedBuy, foreign, cancelled, waiting, notOnChain];
  let userId: string;

  beforeAll(async () => {
    userId = ((await sql.query(`insert into users (wallet_address) values ($1) returning id`, [EOA])) as { id: string }[])[0].id;
    await sql.query(
      `insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, quantity, usd_value, placed_at)
       values ($1, $2, 'buy', 'SGOV', $3, 0.5, 50, '2026-09-20T10:00:00Z')`,
      [userId, tx(0x102), SGOV.address.toLowerCase()],
    );
  });

  const deps = () =>
    depsFor(items, {
      fillOnChain: vi.fn(async (fillTx: string) => ({ ok: fillTx !== tx(9000 + 0x106), filledAt: new Date("2026-09-25T09:19:30Z") })),
    });

  it("dry run: finds the missing sell, leaves the rest, writes nothing", async () => {
    const used = deps();
    const report = await recoverAccountOrders({ id: userId, wallet_address: EOA }, { deps: used });
    expect(report.addresses).toBe(2);
    expect(report.intents).toBe(6);
    expect(report.berthFilled).toBe(3);
    expect(report.alreadyRecorded).toBe(1);
    expect(report.recovered).toHaveLength(1);
    expect(report.recovered[0]).toMatchObject({
      intentTx: tx(0x101),
      direction: "sell",
      listingSymbol: "SGOV",
      quantity: "0.018877516067001",
      walletAddress: HUB,
      fillTx: tx(9000 + 0x101),
      filledAt: new Date("2026-09-25T09:19:30Z"),
      xpPaid: false,
    });
    expect(report.rejected).toEqual([{ intentTx: tx(0x106), reason: "fill not on chain" }]);
    expect(report.written).toBe(0);
    expect(used.verify).toHaveBeenCalledWith(expect.objectContaining({ txHash: tx(0x101), direction: "out", wallets: [{ family: "evm", address: EOA, linkedAt: null, unlinkedAt: null }] }));
    const rows = (await sql.query(`select count(*)::int as n from orders`)) as { n: number }[];
    expect(rows[0].n).toBe(1);
  });

  it("write: inserts the sell, keeps the recorded buy exactly, pays no XP, and a rerun adds nothing", async () => {
    const before = (await sql.query(`select * from orders where intent_tx = $1`, [tx(0x102)])) as Record<string, unknown>[];
    const used = deps();
    const summary = await recoverOrders({ write: true, deps: used });
    expect(summary).toMatchObject({ accounts: 1, recovered: 1, written: 1, xpUnpaid: 1, rejected: 1 });
    expect(used.marks).toHaveBeenCalledTimes(1);
    const sold = (await sql.query(`select * from orders where intent_tx = $1`, [tx(0x101)])) as Record<string, unknown>[];
    expect(sold).toHaveLength(1);
    expect(sold[0]).toMatchObject({ user_id: userId, direction: "sell", listing_symbol: "SGOV", fill_tx: tx(9000 + 0x101), order_type: "market" });
    expect(Number(sold[0].quantity)).toBeCloseTo(0.018877516067001, 12);
    expect(sold[0].hold_checked_at).not.toBeNull();
    const after = (await sql.query(`select * from orders where intent_tx = $1`, [tx(0x102)])) as Record<string, unknown>[];
    expect(after).toEqual(before);
    const xp = (await sql.query(`select count(*)::int as n from xp_events`)) as { n: number }[];
    expect(xp[0].n).toBe(0);
    for (const ignored of [tx(0x103), tx(0x104), tx(0x105), tx(0x106)]) {
      expect(((await sql.query(`select 1 from orders where intent_tx = $1`, [ignored])) as unknown[]).length).toBe(0);
    }

    const again = await recoverOrders({ write: true, deps: deps() });
    expect(again).toMatchObject({ recovered: 0, written: 0 });
    const count = (await sql.query(`select count(*)::int as n from orders`)) as { n: number }[];
    expect(count[0].n).toBe(2);
  });

  it("a buy delivered to the account by a payer not proven its is recovered, marked to pay nothing", async () => {
    const owner = ((await sql.query(`insert into users (wallet_address) values ($1) returning id`, [
      "0x5555555555555555555555555555555555555555",
    ])) as { id: string }[])[0].id;
    const gift = item({ txHash: tx(0x301), input: USDC_HUB, output: NVDA.address });
    const report = await recoverAccountOrders(
      { id: owner, wallet_address: "0x5555555555555555555555555555555555555555" },
      {
        write: true,
        deps: depsFor([gift], {
          fetchIntents: vi.fn(async () => [gift]),
          verify: vi.fn(async () => ({ ok: true as const, intent: asIntent(gift), sodax: {} as Sodax, unprovenSource: true as const })),
        }),
      },
    );
    expect(report.written).toBe(1);
    expect(await sql.query(`select reason from no_xp_intents where intent_tx = $1`, [tx(0x301)])).toEqual([{ reason: "unproven_source" }]);
    expect(await sql.query(`select user_id from orders where intent_tx = $1`, [tx(0x301)])).toEqual([{ user_id: owner }]);
  });

  it("a recovered unproven-source buy whose XP was already paid is never marked (m1)", async () => {
    const owner = ((await sql.query(`insert into users (wallet_address) values ($1) returning id`, [
      "0x5656565656565656565656565656565656565656",
    ])) as { id: string }[])[0].id;
    const paid = item({ txHash: tx(0x302), input: USDC_HUB, output: NVDA.address });
    await sql.query(`insert into xp_events (user_id, kind, amount, ref) values ($1, 'pour_in', 100, $2)`, [owner, tx(0x302)]);
    const report = await recoverAccountOrders(
      { id: owner, wallet_address: "0x5656565656565656565656565656565656565656" },
      {
        write: true,
        deps: depsFor([paid], {
          fetchIntents: vi.fn(async () => [paid]),
          verify: vi.fn(async () => ({ ok: true as const, intent: asIntent(paid), sodax: {} as Sodax, unprovenSource: true as const })),
        }),
      },
    );
    expect(report.written).toBe(1);
    expect(await sql.query(`select 1 from no_xp_intents where intent_tx = $1`, [tx(0x302)])).toEqual([]);
  });

  it("never takes an order the pour route would refuse as not the account's", async () => {
    const other = ((await sql.query(`insert into users (wallet_address) values ($1) returning id`, [
      "0x3333333333333333333333333333333333333333",
    ])) as { id: string }[])[0].id;
    const stray = item({ txHash: tx(0x201), input: USDC_HUB, output: NVDA.address });
    const report = await recoverAccountOrders(
      { id: other, wallet_address: "0x3333333333333333333333333333333333333333" },
      { deps: depsFor([stray], { fetchIntents: vi.fn(async () => [stray]), verify: vi.fn(async () => ({ ok: false as const, reason: "not your pour" as const })) }), write: true },
    );
    expect(report.recovered).toHaveLength(0);
    expect(report.rejected).toEqual([{ intentTx: tx(0x201), reason: "not your pour" }]);
    expect(((await sql.query(`select 1 from orders where intent_tx = $1`, [tx(0x201)])) as unknown[]).length).toBe(0);
  });

  it("writes a recovered Robinhood Chain buy as held there, under the Sonic listing (the recovery writer)", async () => {
    const owner = ((await sql.query(`insert into users (wallet_address) values ($1) returning id`, [
      "0x7777777777777777777777777777777777777777",
    ])) as { id: string }[])[0].id;
    const base = item({ txHash: tx(0x401), input: USDC_HUB, output: NVDA.rhHubAsset! });
    const rh: IntentResponse = { ...base, intent: { ...base.intent, dstChain: 21071, dstAddress: "0x7777777777777777777777777777777777777777" } };
    const report = await recoverAccountOrders(
      { id: owner, wallet_address: "0x7777777777777777777777777777777777777777" },
      {
        write: true,
        deps: depsFor([rh], {
          fetchIntents: vi.fn(async () => [rh]),
          build: vi.fn(async ({ intentTx, direction, intent }) =>
            readOrder({
              intentTx,
              direction,
              intent,
              listing: { symbol: NVDA.symbol, address: NVDA.address, decimals: NVDA.decimals },
              pay: { symbol: "USDC", decimals: 6, chainKey: "0x2105.base" },
              received: 5n * 10n ** 15n,
              placedAt: new Date("2026-10-05T09:19:00Z"),
            }),
          ),
        }),
      },
    );
    expect(report.written).toBe(1);
    expect(await sql.query(`select holding_chain, listing_address, delivered_to from orders where intent_tx = $1`, [tx(0x401)])).toEqual([
      { holding_chain: "robinhood", listing_address: NVDA.address.toLowerCase(), delivered_to: "0x7777777777777777777777777777777777777777" },
    ]);
  });

  it("names the hub on every other recovered row", async () => {
    expect(await sql.query(`select distinct holding_chain from orders where intent_tx in ($1, $2)`, [tx(0x101), tx(0x301)])).toEqual([
      { holding_chain: "sonic" },
    ]);
  });
});
