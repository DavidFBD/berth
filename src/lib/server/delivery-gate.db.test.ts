import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Intent } from "@sodax/sdk";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { gateRobinhoodBuy, markDeliveryOk, settleRobinhoodClaim } from "./delivery-gate";
import { payClaim, savePourClaim, settlePourClaims, type ClaimPayDeps } from "./pour-claims";
import type { DestinationCheck } from "./delivery";

/**
 * The server's say over a buy delivered on Robinhood Chain, against the
 * real schema: the pour route's re-check (stubbed here; its decision is
 * lib/server/delivery-recheck.test) marks a refused buy to pay nothing,
 * and the evening pass pays a Robinhood Chain claim only on the route's
 * recorded allowance.
 */

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

const q = <T = Record<string, unknown>>(text: string, params: unknown[] = []) => sql.query(text, params) as Promise<T[]>;
const account = async (wallet: string) => (await q<{ id: string }>(`insert into users (wallet_address) values ($1) returning id`, [wallet]))[0].id;
const BUYER = "0x1111111111111111111111111111111111111111";
const rhBuy = { srcChain: 30n, dstChain: 21071n, dstAddress: BUYER } as unknown as Intent;
const hubBuy = { srcChain: 30n, dstChain: 146n, dstAddress: "0x2222222222222222222222222222222222222222" } as unknown as Intent;
const inputs = { userId: "u", usersWallet: BUYER, signer: BUYER, availability: undefined, country: "NL" };
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const reason = async (intentTx: string) => (await q<{ reason: string }>(`select reason from no_xp_intents where intent_tx = $1`, [intentTx]))[0]?.reason;
const answering = (check: DestinationCheck) => vi.fn(async () => check);

describe("gateRobinhoodBuy (the pour route)", () => {
  it("never touches a hub buy or a sell", async () => {
    const recheck = answering({ verdict: "refused", reason: "not_listed" });
    expect(await gateRobinhoodBuy({ intentTx: tx(1), direction: "buy", intent: hubBuy, inputs, recheck })).toBe("hub");
    expect(await gateRobinhoodBuy({ intentTx: tx(1), direction: "sell", intent: { ...rhBuy, srcChain: 21071n } as Intent, inputs, recheck })).toBe("hub");
    expect(recheck).not.toHaveBeenCalled();
    expect(await reason(tx(1))).toBeUndefined();
  });

  it("refuses a Robinhood Chain buy from an account not switched on: recorded elsewhere, here marked to pay nothing", async () => {
    const recheck = answering({ verdict: "refused", reason: "not_listed" });
    expect(await gateRobinhoodBuy({ intentTx: tx(2), direction: "buy", intent: rhBuy, inputs, recheck })).toBe("refused");
    expect(recheck).toHaveBeenCalledWith(expect.objectContaining({ dstAddress: BUYER, country: "NL" }));
    expect(await reason(tx(2))).toBe("delivery_refused");
  });

  it("refuses one reported from a country Robinhood does not offer its tokens in", async () => {
    expect(await gateRobinhoodBuy({ intentTx: tx(3), direction: "buy", intent: rhBuy, inputs: { ...inputs, country: "GB" }, recheck: answering({ verdict: "refused", reason: "restricted_country" }) })).toBe(
      "refused",
    );
    expect(await reason(tx(3))).toBe("delivery_refused");
  });

  it("marks nothing for an allowed one, nor for a read that did not answer", async () => {
    expect(await gateRobinhoodBuy({ intentTx: tx(4), direction: "buy", intent: rhBuy, inputs, recheck: answering({ verdict: "allowed" }) })).toBe("allowed");
    expect(await gateRobinhoodBuy({ intentTx: tx(5), direction: "buy", intent: rhBuy, inputs, recheck: answering({ verdict: "unknown" }) })).toBe("unknown");
    expect(await reason(tx(4))).toBeUndefined();
    expect(await reason(tx(5))).toBeUndefined();
  });

  it("never decides again once paid or marked: a replay changes nothing", async () => {
    const user = await account("0x3333333333333333333333333333333333333333");
    await q(`insert into xp_events (user_id, kind, amount, ref) values ($1, 'pour_in', 100, $2)`, [user, tx(6)]);
    const recheck = answering({ verdict: "refused", reason: "not_listed" });
    expect(await gateRobinhoodBuy({ intentTx: tx(6), direction: "buy", intent: rhBuy, inputs, recheck })).toBe("settled");
    expect(await gateRobinhoodBuy({ intentTx: tx(2), direction: "buy", intent: rhBuy, inputs, recheck })).toBe("settled");
    expect(recheck).not.toHaveBeenCalled();
    expect(await reason(tx(6))).toBeUndefined();
  });
});

describe("a Robinhood Chain claim in the evening pass", () => {
  const deps = (record = vi.fn(async (claim: { intent_tx: string; user_id: string }) => {
    await q(`insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, holding_chain) values ($1, $2, 'buy', 'NVDA', '0xl', 'robinhood') on conflict do nothing`, [
      claim.user_id,
      claim.intent_tx,
    ]);
  })): ClaimPayDeps => ({
    readIntent: async () => rhBuy,
    prove: async () => ({ ok: true, payer: { family: "evm", address: BUYER } }),
    record,
  });

  it("is paid when the pour route allowed its destination", async () => {
    const user = await account("0x4444444444444444444444444444444444444444");
    await savePourClaim(user, tx(10), "buy", null, "NVDA");
    await markDeliveryOk(tx(10), user);
    const summary = await settlePourClaims({ verdictOf: async () => "filled", pay: (claim) => payClaim(claim, deps()) });
    expect(summary).toMatchObject({ paid: 1, recorded: 0 });
    expect(await q(`select outcome from pour_claims where intent_tx = $1`, [tx(10)])).toEqual([{ outcome: "paid" }]);
    expect(await reason(tx(10))).toBeUndefined();
  });

  it("is recorded and pays nothing when the route never allowed it (a client that gave up on its retries)", async () => {
    const user = await account("0x5555555555555555555555555555555555555555");
    await savePourClaim(user, tx(11), "buy", null, "NVDA");
    const summary = await settlePourClaims({ verdictOf: async () => "filled", pay: (claim) => payClaim(claim, deps()) });
    expect(summary).toMatchObject({ paid: 0, recorded: 1 });
    expect(await q(`select outcome from pour_claims where intent_tx = $1`, [tx(11)])).toEqual([{ outcome: "recorded_no_xp" }]);
    expect(await reason(tx(11))).toBe("delivery_refused");
    expect(await q(`select holding_chain from orders where intent_tx = $1`, [tx(11)])).toEqual([{ holding_chain: "robinhood" }]);
    expect(await q(`select count(*)::int as n from xp_events where ref = $1`, [tx(11)])).toEqual([{ n: 0 }]);
  });

  it("settleRobinhoodClaim leaves a paid one alone", async () => {
    const user = await account("0x6666666666666666666666666666666666666666");
    await savePourClaim(user, tx(12), "buy", null, "NVDA");
    await q(`insert into xp_events (user_id, kind, amount, ref) values ($1, 'pour_in', 100, $2)`, [user, tx(12)]);
    expect(await settleRobinhoodClaim({ intent_tx: tx(12), user_id: user })).toBe("settled");
    expect(await reason(tx(12))).toBeUndefined();
  });

  it("writes delivery_ok only on the claim it names", async () => {
    const user = await account("0x7777777777777777777777777777777777777777");
    await savePourClaim(user, tx(13), "buy", null, "NVDA");
    await savePourClaim(user, tx(14), "buy", null, "NVDA");
    await markDeliveryOk(tx(13), user);
    expect(await q(`select intent_tx, delivery_ok from pour_claims where intent_tx in ($1, $2) order by intent_tx`, [tx(13), tx(14)])).toEqual([
      { intent_tx: tx(13), delivery_ok: true },
      { intent_tx: tx(14), delivery_ok: null },
    ]);
  });
});
