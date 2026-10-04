import { expect } from "vitest";
import { getSql } from "../db";
import { getOrCreateUser, type UserRow } from "../accounts";
import { toCaip10 } from "@/lib/identity/caip";
import { attributeInvite, campaignById, claimById } from "./store";
import { advanceClaim, runCampaignStep } from "./eligibility";

/**
 * Test-only fixtures for the invite campaign tests (PGlite): campaigns,
 * inviters, invited friends with the invite bound, the three set up facts,
 * visits, and a claim walked all the way to qualified.
 */

export const DAY = 86_400_000;
let seq = 0;
/** The campaign made last: invited() counts a friend there unless told otherwise. */
let lastCode: string | undefined;
export const next = () => (seq += 1);
export const hex = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

export async function campaign(
  code: string,
  {
    active = true,
    maxClaims = 20,
    budget = 100,
    amount = 5,
    startsInDays = -1,
    endsInDays = 30,
    stayDays = 14,
    perInviter = 3,
    kind = "invite",
  }: {
    active?: boolean;
    maxClaims?: number;
    budget?: number;
    amount?: number;
    startsInDays?: number;
    endsInDays?: number;
    stayDays?: number;
    perInviter?: number;
    kind?: "invite" | "buy";
  } = {},
): Promise<string> {
  const rows = (await getSql().query(
    `insert into campaigns (code, title, kind, starts_at, ends_at, active, max_claims, budget_usd, amount_usd, hold_days, max_per_inviter)
     values ($1, $1, $10, now() + make_interval(days => $2), now() + make_interval(days => $3), $4, $5, $6, $7, $8, $9) returning id`,
    [code, startsInDays, endsInDays, active, maxClaims, budget, amount, stayDays, perInviter, kind],
  )) as { id: string }[];
  lastCode = code;
  return rows[0].id;
}

/** An account with a home wallet and, unless asked not to, a verified email. */
export async function person({ email = true }: { email?: boolean | string } = {}): Promise<UserRow & { home: string }> {
  const n = next();
  const home = hex(0x100000 + n);
  const user = (await getOrCreateUser({ did: `did:privy:kit-${n}`, wallet: home }))!.user;
  const address = typeof email === "string" ? email : email ? `p${n}@example.com` : null;
  if (address) await getSql().query(`update users set email = $2 where id = $1`, [user.id, address]);
  return { ...user, email: address, home };
}

/**
 * A friend `inviter` invited: a new account with the invite bound, and its
 * claim made as the profile sync makes it. `expectClaim: false` for the
 * cases where none should be.
 */
export async function invited(
  inviter: Pick<UserRow, "id">,
  { email = true, code = lastCode, expectClaim = true }: { email?: boolean | string; code?: string; expectClaim?: boolean } = {},
): Promise<{ user: UserRow & { home: string }; claimId: string }> {
  const user = await person({ email });
  await getSql().query(`update users set referred_by = $2 where id = $1`, [user.id, inviter.id]);
  const claimId = await attributeInvite(user.id, code);
  if (expectClaim) expect(claimId).toBeTruthy();
  return { user: { ...user, referred_by: inviter.id }, claimId: claimId ?? "" };
}

/** The username, the last of the three set up facts (the email and the wallet come with person()). */
export async function username(user: Pick<UserRow, "id">): Promise<void> {
  const n = next();
  await getSql().query(`insert into handles (user_id, handle, handle_norm) values ($1, $2, $2) on conflict do nothing`, [user.id, `kit${n}x`]);
}

/** A signed in visit at `at` (users.last_seen_at). */
export async function seen(user: Pick<UserRow, "id">, at: Date): Promise<void> {
  await getSql().query(`update users set last_seen_at = $2 where id = $1`, [user.id, at.toISOString()]);
}

/**
 * An EVM wallet `user` also holds. A wallet is on one account at a time
 * (user_identities_kind_value), so one already on another account is moved
 * here, as relinking it elsewhere does; that account's users.wallet_address
 * keeps naming it, so both people stand on it.
 */
export async function heldWallet(user: Pick<UserRow, "id">, address: string): Promise<void> {
  const value = toCaip10("evm", address);
  const moved = (await getSql().query(`update user_identities set user_id = $1, is_home = false where kind = 'wallet' and value = $2 returning 1`, [user.id, value])) as unknown[];
  if (moved.length === 0) {
    await getSql().query(`insert into user_identities (user_id, kind, value, family, is_home, proof) values ($1, 'wallet', $2, 'evm', false, 'siwe')`, [user.id, value]);
  }
}

export async function advance(claimId: string, now = new Date(Date.now() + 2_000)) {
  const claim = (await claimById(claimId))!;
  return advanceClaim(claim, (await campaignById(claim.campaign_id))!, now);
}

export async function state(claimId: string) {
  const claim = (await claimById(claimId))!;
  return { state: claim.state, reason: claim.reject_reason ?? claim.expire_reason ?? null };
}

/**
 * A claim walked to qualified: an inviter (or the one given), a friend set
 * up, a place reserved, a visit inside the last week of the stay, and the
 * morning step run after it.
 */
export async function qualifiedClaim(
  code: string,
  inviter?: UserRow & { home: string },
): Promise<{ claimId: string; inviter: UserRow & { home: string }; friend: UserRow & { home: string } }> {
  const who = inviter ?? (await person());
  const { user, claimId } = await invited(who, { code });
  await username(user);
  expect(await advance(claimId)).toBe("holding");
  const claim = (await claimById(claimId))!;
  await seen(user, new Date(claim.eligible_at!.getTime() - DAY));
  await runCampaignStep({ now: new Date(claim.eligible_at!.getTime() + 60_000) });
  expect((await claimById(claimId))!.state).toBe("qualified");
  return { claimId, inviter: who, friend: user };
}
