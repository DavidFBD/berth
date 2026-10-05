import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Intent } from "@sodax/sdk";
import { setSqlClient, type SqlClient } from "./db";
import { makeTestDb } from "./pglite-test-db";
import { gateRobinhoodBuy, requestDelivery, settleRecoveredRobinhoodBuy, settleRobinhoodClaim } from "./delivery-gate";
import { payClaim, savePourClaim, settlePourClaims, type ClaimPayDeps } from "./pour-claims";
import type { DestinationCheck, recheckDestination } from "./delivery";

/**
 * The server's say over a buy delivered on Robinhood Chain, against the
 * real schema: the pour route's re-check (stubbed here; its decision is
 * lib/server/delivery-recheck.test) marks a refused buy to pay nothing and
 * writes its decision on the claim with the facts it was made from; the
 * evening pass pays a Robinhood Chain claim only once it is allowed,
 * deciding an open one again from those facts, and refuses one still open
 * after seven days.
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
const SWITCHED = "00000000-0000-4000-8000-000000000001";
const inputs = { userId: SWITCHED, usersWallet: BUYER, signer: BUYER, availability: undefined, country: "NL" };
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const reason = async (intentTx: string) => (await q<{ reason: string }>(`select reason from no_xp_intents where intent_tx = $1`, [intentTx]))[0]?.reason;
const answering = (check: DestinationCheck) => vi.fn<typeof recheckDestination>(async () => check);
const claimOf = async (intentTx: string) =>
  (await q(`select delivery_ok, delivery_signer, delivery_place_ok, settled_at is not null as settled, outcome from pour_claims where intent_tx = $1`, [intentTx]))[0];

beforeEach(() => vi.stubEnv("ROBINHOOD_DELIVERY_USERS", SWITCHED));
afterEach(() => vi.unstubAllEnvs());

describe("gateRobinhoodBuy (the pour route)", () => {
  it("never touches a hub buy or a sell", async () => {
    const recheck = answering({ verdict: "refused", reason: "not_listed" });
    expect(await gateRobinhoodBuy({ intentTx: tx(1), direction: "buy", intent: hubBuy, inputs, recheck })).toEqual({ outcome: "hub" });
    expect(await gateRobinhoodBuy({ intentTx: tx(1), direction: "sell", intent: { ...rhBuy, srcChain: 21071n } as Intent, inputs, recheck })).toEqual({ outcome: "hub" });
    expect(recheck).not.toHaveBeenCalled();
    expect(await reason(tx(1))).toBeUndefined();
  });

  it("refuses a Robinhood Chain buy from an account not switched on, from the place alone", async () => {
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", "");
    const recheck = answering({ verdict: "refused", reason: "not_listed" });
    expect(await gateRobinhoodBuy({ intentTx: tx(2), direction: "buy", intent: rhBuy, inputs, recheck })).toEqual({
      outcome: "refused",
      delivery: { ok: false, signer: BUYER, placeOk: false },
    });
    expect(recheck).toHaveBeenCalledWith(expect.objectContaining({ dstAddress: BUYER, signer: BUYER, place: { ok: false, reason: "not_listed" } }));
    expect(await reason(tx(2))).toBe("delivery_refused");
  });

  it("refuses one reported from a country Robinhood does not offer its tokens in", async () => {
    const recheck = answering({ verdict: "refused", reason: "restricted_country" });
    const gate = await gateRobinhoodBuy({ intentTx: tx(3), direction: "buy", intent: rhBuy, inputs: { ...inputs, country: "GB" }, recheck });
    expect(gate).toEqual({ outcome: "refused", delivery: { ok: false, signer: BUYER, placeOk: false } });
    expect(recheck).toHaveBeenCalledWith(expect.objectContaining({ place: { ok: false, reason: "restricted_country" } }));
    expect(await reason(tx(3))).toBe("delivery_refused");
  });

  it("marks nothing for an allowed one, nor for a read that did not answer, and says what to write on the claim", async () => {
    expect(await gateRobinhoodBuy({ intentTx: tx(4), direction: "buy", intent: rhBuy, inputs, recheck: answering({ verdict: "allowed" }) })).toEqual({
      outcome: "allowed",
      delivery: { ok: true, signer: BUYER, placeOk: true },
    });
    expect(await gateRobinhoodBuy({ intentTx: tx(5), direction: "buy", intent: rhBuy, inputs, recheck: answering({ verdict: "unknown" }) })).toEqual({
      outcome: "unknown",
      delivery: { ok: null, signer: BUYER, placeOk: true },
    });
    expect(await reason(tx(4))).toBeUndefined();
    expect(await reason(tx(5))).toBeUndefined();
  });

  it("never decides again once paid or marked: a replay changes nothing", async () => {
    const user = await account("0x3333333333333333333333333333333333333333");
    await q(`insert into xp_events (user_id, kind, amount, ref) values ($1, 'pour_in', 100, $2)`, [user, tx(6)]);
    const recheck = answering({ verdict: "refused", reason: "not_listed" });
    expect(await gateRobinhoodBuy({ intentTx: tx(6), direction: "buy", intent: rhBuy, inputs, recheck })).toEqual({ outcome: "settled" });
    expect(await gateRobinhoodBuy({ intentTx: tx(2), direction: "buy", intent: rhBuy, inputs, recheck })).toEqual({ outcome: "settled" });
    expect(recheck).not.toHaveBeenCalled();
    expect(await reason(tx(6))).toBeUndefined();
  });

  it("keeps a claim's decision once written, and an open claim's first facts", async () => {
    const user = await account("0x3434343434343434343434343434343434343434");
    const mine = { ...inputs, userId: user };
    vi.stubEnv("ROBINHOOD_DELIVERY_USERS", user);
    await savePourClaim(user, tx(7), "buy", null, "NVDA", { delivery: { ok: true, signer: BUYER, placeOk: true } });
    const recheck = answering({ verdict: "refused", reason: "other_address" });
    expect((await gateRobinhoodBuy({ intentTx: tx(7), direction: "buy", intent: rhBuy, inputs: mine, recheck })).outcome).toBe("allowed");
    expect(recheck).not.toHaveBeenCalled();
    // Kept open from Amsterdam; a retry from London is judged on the first report's place and signer.
    await savePourClaim(user, tx(8), "buy", null, "NVDA", { delivery: { ok: null, signer: BUYER, placeOk: true } });
    const allow = answering({ verdict: "allowed" });
    const gate = await gateRobinhoodBuy({ intentTx: tx(8), direction: "buy", intent: rhBuy, inputs: { ...mine, country: "GB", signer: "0x9999999999999999999999999999999999999999" }, recheck: allow });
    expect(gate).toEqual({ outcome: "allowed", delivery: { ok: true, signer: BUYER, placeOk: true } });
    expect(allow).toHaveBeenCalledWith(expect.objectContaining({ signer: BUYER, place: { ok: true } }));
  });
});

describe("savePourClaim's delivery columns", () => {
  it("writes the decision and its facts in the statement that keeps the claim, and a decision once written stands", async () => {
    const user = await account("0x7777777777777777777777777777777777777777");
    await savePourClaim(user, tx(13), "buy", null, "NVDA", { delivery: { ok: null, signer: BUYER, placeOk: true } });
    expect(await claimOf(tx(13))).toMatchObject({ delivery_ok: null, delivery_signer: BUYER, delivery_place_ok: true });
    await savePourClaim(user, tx(13), "buy", null, "NVDA", { delivery: { ok: false, signer: "0x9999999999999999999999999999999999999999", placeOk: false } });
    expect(await claimOf(tx(13))).toMatchObject({ delivery_ok: false, delivery_signer: BUYER, delivery_place_ok: true });
    await savePourClaim(user, tx(13), "buy", null, "NVDA", { delivery: { ok: true, signer: BUYER, placeOk: true } });
    expect(await claimOf(tx(13))).toMatchObject({ delivery_ok: false });
    // A hub claim names none of them.
    await savePourClaim(user, tx(14), "buy", null, "NVDA");
    expect(await claimOf(tx(14))).toMatchObject({ delivery_ok: null, delivery_signer: null, delivery_place_ok: null });
  });

  it("requestDelivery keeps the place as a yes or no and the signer, never the country", () => {
    expect(requestDelivery(inputs)).toEqual({ ok: null, signer: BUYER, placeOk: true });
    expect(requestDelivery({ ...inputs, country: "CA" })).toEqual({ ok: null, signer: BUYER, placeOk: false });
    expect(requestDelivery({ ...inputs, signer: undefined, country: null })).toEqual({ ok: null, signer: null, placeOk: false });
  });
});

describe("a Robinhood Chain claim in the evening pass", () => {
  const record = vi.fn(async (claim: { intent_tx: string; user_id: string }) => {
    await q(`insert into orders (user_id, intent_tx, direction, listing_symbol, listing_address, holding_chain) values ($1, $2, 'buy', 'NVDA', '0xl', 'robinhood') on conflict do nothing`, [
      claim.user_id,
      claim.intent_tx,
    ]);
  });
  const deps = (recheck: typeof recheckDestination = answering({ verdict: "unknown" })): ClaimPayDeps => ({
    readIntent: async () => rhBuy,
    prove: async () => ({ ok: true, payer: { family: "evm", address: BUYER } }),
    record,
    settleRobinhood: (claim, intent) => settleRobinhoodClaim(claim, intent, { recheck }),
  });
  const pass = (recheck?: typeof recheckDestination) => settlePourClaims({ verdictOf: async () => "filled", pay: (claim) => payClaim(claim, deps(recheck)) });
  const xpFor = async (intentTx: string) => (await q<{ n: number }>(`select count(*)::int as n from xp_events where ref = $1`, [intentTx]))[0].n;
  const age = (intentTx: string, days: number) => q(`update pour_claims set created_at = now() - make_interval(days => $2) where intent_tx = $1`, [intentTx, days]);
  const settleAll = () => q(`update pour_claims set settled_at = now() where settled_at is null`);

  it("is paid once when the pour route allowed its destination", async () => {
    await settleAll();
    const user = await account("0x4444444444444444444444444444444444444444");
    await savePourClaim(user, tx(10), "buy", null, "NVDA", { delivery: { ok: true, signer: BUYER, placeOk: true } });
    expect(await pass()).toMatchObject({ paid: 1, recorded: 0 });
    expect(await claimOf(tx(10))).toMatchObject({ outcome: "paid" });
    expect(await reason(tx(10))).toBeUndefined();
    expect(await xpFor(tx(10))).toBe(1);
  });

  it("is recorded and pays nothing when the route refused it, then or ever", async () => {
    await settleAll();
    const user = await account("0x5555555555555555555555555555555555555555");
    await savePourClaim(user, tx(11), "buy", null, "NVDA", { delivery: { ok: false, signer: BUYER, placeOk: false } });
    expect(await pass(answering({ verdict: "allowed" }))).toMatchObject({ paid: 0, recorded: 1 });
    expect(await claimOf(tx(11))).toMatchObject({ outcome: "recorded_no_xp" });
    expect(await reason(tx(11))).toBe("delivery_refused");
    expect(await q(`select holding_chain from orders where intent_tx = $1`, [tx(11)])).toEqual([{ holding_chain: "robinhood" }]);
    expect(await xpFor(tx(11))).toBe(0);
    // A later report finds it decided.
    expect(await gateRobinhoodBuy({ intentTx: tx(11), direction: "buy", intent: rhBuy, inputs: { ...inputs, userId: user }, recheck: answering({ verdict: "allowed" }) })).toEqual({
      outcome: "settled",
    });
  });

  it("stays open while a read keeps the decision open (the route answered 503, the tab was closed), the order recorded", async () => {
    await settleAll();
    const user = await account("0x5656565656565656565656565656565656565656");
    await savePourClaim(user, tx(15), "buy", null, "NVDA", { delivery: { ok: null, signer: BUYER, placeOk: true } });
    expect(await pass(answering({ verdict: "unknown" }))).toMatchObject({ paid: 0, recorded: 0 });
    expect(await claimOf(tx(15))).toMatchObject({ settled: false, delivery_ok: null });
    expect(await reason(tx(15))).toBeUndefined();
    expect(await q(`select holding_chain from orders where intent_tx = $1`, [tx(15)])).toEqual([{ holding_chain: "robinhood" }]);
    // The next night the reads answer: decided from the stored facts, written, paid.
    const allow = answering({ verdict: "allowed" });
    expect(await pass(allow)).toMatchObject({ paid: 1 });
    expect(allow).toHaveBeenCalledWith(expect.objectContaining({ userId: user, signer: BUYER, place: { ok: true }, dstAddress: BUYER }));
    expect(await claimOf(tx(15))).toMatchObject({ outcome: "paid", delivery_ok: true });
    expect(await xpFor(tx(15))).toBe(1);
  });

  it("decides an open claim from its stored place: a no at report time refuses it, whatever the switch says now", async () => {
    await settleAll();
    const user = await account("0x5757575757575757575757575757575757575757");
    await savePourClaim(user, tx(16), "buy", null, "NVDA", { delivery: { ok: null, signer: BUYER, placeOk: false } });
    const recheck = vi.fn<typeof recheckDestination>(async ({ place }) => (place.ok ? { verdict: "allowed" } : { verdict: "refused", reason: place.reason }));
    expect(await pass(recheck)).toMatchObject({ recorded: 1 });
    expect(await claimOf(tx(16))).toMatchObject({ outcome: "recorded_no_xp", delivery_ok: false });
    expect(await reason(tx(16))).toBe("delivery_refused");
  });

  it("refuses a claim still undecided seven days after it was kept, and one kept with no facts at all", async () => {
    await settleAll();
    const user = await account("0x5858585858585858585858585858585858585858");
    await savePourClaim(user, tx(17), "buy", null, "NVDA", { delivery: { ok: null, signer: BUYER, placeOk: true } });
    await savePourClaim(user, tx(18), "buy", null, "NVDA");
    expect(await pass()).toMatchObject({ paid: 0, recorded: 0 });
    expect(await reason(tx(18))).toBeUndefined();
    await age(tx(17), 8);
    await age(tx(18), 8);
    expect(await pass()).toMatchObject({ paid: 0, recorded: 2 });
    for (const intentTx of [tx(17), tx(18)]) {
      expect(await claimOf(intentTx)).toMatchObject({ outcome: "recorded_no_xp", delivery_ok: false });
      expect(await reason(intentTx)).toBe("delivery_refused");
      expect(await xpFor(intentTx)).toBe(0);
    }
  });

  it("settleRobinhoodClaim leaves a paid one alone", async () => {
    const user = await account("0x6666666666666666666666666666666666666666");
    await savePourClaim(user, tx(12), "buy", null, "NVDA");
    await q(`insert into xp_events (user_id, kind, amount, ref) values ($1, 'pour_in', 100, $2)`, [user, tx(12)]);
    expect(await settleRobinhoodClaim({ intent_tx: tx(12), user_id: user }, rhBuy)).toBe("settled");
    expect(await reason(tx(12))).toBeUndefined();
  });
});

describe("settleRecoveredRobinhoodBuy", () => {
  it("refuses a buy only recovery found, leaves one with an open claim to the evening pass, and never marks a paid one", async () => {
    expect(await settleRecoveredRobinhoodBuy(tx(20))).toBe("refused");
    expect(await reason(tx(20))).toBe("delivery_refused");
    expect(await settleRecoveredRobinhoodBuy(tx(20))).toBe("settled");
    const user = await account("0x6767676767676767676767676767676767676767");
    await savePourClaim(user, tx(21), "buy", null, "NVDA", { delivery: { ok: null, signer: BUYER, placeOk: true } });
    expect(await settleRecoveredRobinhoodBuy(tx(21))).toBe("claim");
    expect(await reason(tx(21))).toBeUndefined();
    await q(`insert into xp_events (user_id, kind, amount, ref) values ($1, 'pour_in', 100, $2)`, [user, tx(22)]);
    expect(await settleRecoveredRobinhoodBuy(tx(22))).toBe("settled");
    expect(await reason(tx(22))).toBeUndefined();
  });
});
