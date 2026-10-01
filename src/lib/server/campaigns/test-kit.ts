import { expect } from "vitest";
import { getSql } from "../db";
import { getOrCreateUser, type UserRow } from "../accounts";
import { STOCK_LISTINGS } from "@/lib/listings";
import { attributeCampaign, campaignById, claimById } from "./store";
import { advanceClaim, type EligibilityDeps } from "./eligibility";
import type { HoldQuery, HoldVerifier } from "./hold-window";

/**
 * Test-only fixtures for the campaign tests (PGlite): campaigns, arrivals,
 * buys delivered to the person's own hub wallet, a hub derivation that
 * needs no chain, and hold verifiers that answer without one.
 */

export const STOCK = STOCK_LISTINGS[0];
export const DAY = 86_400_000;
let seq = 0;
export const next = () => (seq += 1);
export const hex = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

/** A stand-in for the SDK's hub derivation: deterministic, distinct from the spoke. */
export const hubOf = (spoke: string) => `0xb${spoke.toLowerCase().slice(3)}`;
export const DEPS: EligibilityDeps = { deriveHubWallet: async (spoke) => hubOf(spoke) };

export async function campaign(
  code: string,
  { active = true, maxClaims = 20, budget = 100, amount = 5, startsInDays = -1, endsInDays = 30, holdDays = 7 } = {},
): Promise<string> {
  const rows = (await getSql().query(
    `insert into campaigns (code, title, starts_at, ends_at, active, max_claims, budget_usd, amount_usd, hold_days)
     values ($1, $1, now() + make_interval(days => $2), now() + make_interval(days => $3), $4, $5, $6, $7, $8) returning id`,
    [code, startsInDays, endsInDays, active, maxClaims, budget, amount, holdDays],
  )) as { id: string }[];
  return rows[0].id;
}

/** A new account with a verified email (unless asked not to), attributed to `code`. */
export async function arrival(code: string, { email = true } = {}): Promise<{ user: UserRow; claimId: string; home: string }> {
  const n = next();
  const home = hex(0x100000 + n);
  const user = (await getOrCreateUser({ did: `did:privy:kit-${n}`, wallet: home }))!.user;
  if (email) await getSql().query(`update users set email = $2 where id = $1`, [user.id, `p${n}@example.com`]);
  const claimId = await attributeCampaign(user.id, code);
  expect(claimId).toBeTruthy();
  return { user: { ...user, email: email ? `p${n}@example.com` : null }, claimId: claimId!, home };
}

export async function buy(
  user: Pick<UserRow, "id" | "wallet_address">,
  {
    usd = 12,
    listing = STOCK.address,
    quantity = "0.05",
    payer = user.wallet_address ?? hex(0x900000 + next()),
    deliveredTo = hubOf(user.wallet_address ?? hex(0x500000 + next())),
    filledAt = new Date(Date.now() + 1_000),
    direction = "buy",
    orderType = "market",
  }: {
    usd?: number | null;
    listing?: string;
    quantity?: string;
    payer?: string;
    deliveredTo?: string;
    filledAt?: Date;
    direction?: string;
    orderType?: string;
  } = {},
): Promise<{ intentTx: string; deliveredTo: string; orderId: string }> {
  const n = next();
  const intentTx = `0x${n.toString(16).padStart(64, "0")}`;
  const rows = (await getSql().query(
    `insert into orders (user_id, wallet_address, src_address, intent_tx, direction, listing_symbol, listing_address, quantity, usd_value, delivered_to, filled_at, placed_at, order_type)
     values ($1, $2, $3, $4, $5, 'X', $6, $7, $8, $9, $10, $10, $11) returning id`,
    // As lib/orders readOrder stores them: wallet_address only for an EVM payer, src_address always.
    [user.id, /^0x[0-9a-f]{40}$/i.test(payer) ? payer.toLowerCase() : null, payer, intentTx, direction, listing, quantity, usd, deliveredTo, filledAt.toISOString(), orderType],
  )) as { id: string }[];
  return { intentTx, deliveredTo, orderId: rows[0].id };
}

export async function advance(claimId: string, now = new Date(Date.now() + 2_000)) {
  const claim = (await claimById(claimId))!;
  return advanceClaim(claim, (await campaignById(claim.campaign_id))!, now, DEPS);
}

export async function state(claimId: string) {
  const claim = (await claimById(claimId))!;
  return { state: claim.state, reason: claim.reject_reason ?? claim.expire_reason ?? null };
}

/** A verifier answering from the query alone: `verdict(query)`, with made up but consistent evidence. */
export function verifier(verdict: (query: HoldQuery) => "held" | "not_held" | "unknown"): HoldVerifier & { asked: HoldQuery[] } {
  const asked: HoldQuery[] = [];
  const fn = (async (query: HoldQuery) => {
    asked.push(query);
    const answer = verdict(query);
    if (answer === "unknown") return { verdict: "unknown", error: "rpc down" } as const;
    const raw = answer === "held" ? "50000000000000000" : "0";
    return { verdict: answer, balanceRaw: raw, lowestRaw: raw, outflows: answer === "held" ? 0 : 1, fromBlock: "1", toBlock: "2" } as const;
  }) as HoldVerifier & { asked: HoldQuery[] };
  fn.asked = asked;
  return fn;
}
