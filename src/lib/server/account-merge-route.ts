import { NextResponse, type NextRequest } from "next/server";
import { sendNotice } from "@/lib/server/email/send";
import { accountForDid, accountForWallet, normalizeWallet } from "@/lib/server/accounts";
import { doneMerge, mergeAccounts, planMerge, type MergePlan } from "@/lib/server/account-merge";
import { accountOf, asProof, NOT_VERIFIED, privyFresh, signerOf, spend } from "@/lib/server/account-wallets-route";
import { audit } from "@/lib/server/account-wallets";
import { generateSiweNonce } from "viem/siwe";
import { takeRatePlace } from "@/lib/server/oauth/rate-limit";
import { verifyPrivyAuth } from "@/lib/server/privy";
import {
  issueMergeNonceToken,
  issueMergeOfferToken,
  readMergeNonceToken,
  readMergeOfferToken,
  type MergeOffer,
} from "@/lib/server/wallet-session";

/**
 * The two merge routes (app/api/account/merge): the email offer, and the
 * merge itself. Fresh proof of both sides, always:
 *
 * - email: the Privy session of the email's own account, whose code was
 *   entered in the last ten minutes (privyFresh, an email code only), and
 *   a signature by the wallet made now over a merge nonce issued to that
 *   DID for that wallet (mergeNonce), spent once.
 * - wallet: the link route's own proof (a new signature by the wallet, and
 *   the account's confirmation) found the wallet on another account; that
 *   route hands out the offer, to the account that asked, and only then.
 *
 * An offer lives ten minutes and names both accounts and the survivor it
 * was made with. Every refusal before both proofs check out is the same
 * 401, so nothing about an email or a wallet is learnt without them.
 */

/** Offers and merges an account may ask for in an hour. */
export const MERGE_LIMIT_PER_HOUR = 10;

const SLOW_DOWN = () => NextResponse.json({ error: "slow down" }, { status: 429 });
const noStore = { "Cache-Control": "no-store" };

/** What the confirm step needs: who stays, relative to the asker, and the totals after. */
export type MergeOfferView = {
  offer: string;
  survivor: "this" | "other";
  together: MergePlan["together"];
  usernameComes: boolean;
};

export async function offerView(
  requester: string,
  other: string,
  kind: MergeOffer["kind"],
  wallet?: string,
  did?: string,
): Promise<MergeOfferView | null> {
  const plan = await planMerge(requester, other);
  if (!plan) return null;
  await audit(requester, "merge_offered", { otherUserId: other, kind, survivor: plan.survivor === requester ? "requester" : "other" });
  return {
    offer: await issueMergeOfferToken({ requester, other, kind, survivor: plan.survivor, wallet, did }),
    survivor: plan.requesterSurvives ? "this" : "other",
    together: plan.together,
    usernameComes: plan.usernameComes,
  };
}

/** The DID of a Privy token whose email code was entered in the last ten minutes, else null. */
async function freshEmailDid(request: NextRequest): Promise<string | null> {
  let did: string | null = null;
  try {
    did = await verifyPrivyAuth(request.headers.get("authorization"));
  } catch {
    return null;
  }
  if (!did || !(await privyFresh(did))) return null;
  return did;
}

/**
 * POST /api/account/merge/nonce { wallet }: with a Privy token whose email
 * code is fresh, a ten minute nonce for that wallet to sign ("merge"). It
 * names no account, so it answers the same whether the wallet has one.
 */
export async function mergeNonce(request: NextRequest): Promise<NextResponse> {
  const did = await freshEmailDid(request);
  const body = (await request.json().catch(() => ({}))) as { wallet?: unknown };
  const wallet = normalizeWallet(body.wallet);
  if (!did || !wallet || !/^0x[0-9a-f]{40}$/.test(wallet)) return NOT_VERIFIED();
  if (!(await takeRatePlace("account-merge", `nonce:${did}`, MERGE_LIMIT_PER_HOUR))) return SLOW_DOWN();
  const nonce = generateSiweNonce();
  return NextResponse.json({ nonce, nonceToken: await issueMergeNonceToken(nonce, did, wallet) }, { headers: noStore });
}

/**
 * POST /api/account/merge/offer { nonceToken, message, signature }: after
 * the person entered a code for an email that already has an account, the
 * wallet's own signature over the merge nonce, made now (a lingering
 * wallet session is not enough). Answers { state: "offer", offer,
 * survivor, together } or { state: "none" } (no other account, or the same
 * one). Every refusal before both proofs check out is the same 401.
 */
export async function emailOffer(request: NextRequest): Promise<NextResponse> {
  const did = await freshEmailDid(request);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const token = await readMergeNonceToken(body.nonceToken);
  const proof = asProof(body);
  if (!did || !token || token.did !== did || !proof) return NOT_VERIFIED();
  const signer = await signerOf(proof, token.nonce, "merge", token.wallet);
  if (signer !== token.wallet) return NOT_VERIFIED();
  const email = await accountForDid(did);
  if (!(await spend(token.nonce, email?.id ?? null, "merge"))) return NOT_VERIFIED();
  const wallet = await accountForWallet(token.wallet);
  if (!email || !wallet || email.id === wallet.id) return NextResponse.json({ state: "none" }, { headers: noStore });
  if (!(await takeRatePlace("account-merge", `offer:${wallet.id}`, MERGE_LIMIT_PER_HOUR))) return SLOW_DOWN();
  const view = await offerView(wallet.id, email.id, "email", token.wallet, did);
  if (!view) return NextResponse.json({ state: "none" }, { headers: noStore });
  return NextResponse.json({ state: "offer", ...view }, { headers: noStore });
}

export type MergeResponse =
  | { state: "merged"; survivor: "this" | "other"; xp: number }
  /** Something changed since the offer (who would stay, who holds the wallet). Ask again. */
  | { state: "changed" }
  | { state: "failed" };

/**
 * POST /api/account/merge { offer }: the merge. The caller must still be
 * who the offer was made to (for an email merge, both sessions again).
 * A merge already done answers as done, so a retry after a lost answer
 * reads the same.
 */
export async function runMerge(request: NextRequest): Promise<NextResponse> {
  const body = (await request.clone().json().catch(() => ({}))) as { offer?: unknown };
  const offer = await readMergeOfferToken(body.offer);
  if (!offer) return NOT_VERIFIED();
  const done = await doneMerge(offer.requester, offer.other);

  // Who is asking, and are they who the offer was made to (or, after the
  // merge, the account it became)?
  if (offer.kind === "email") {
    // The email side again, still fresh, and the very DID the offer was
    // made to. The wallet side is the signature the offer was made on.
    const did = await freshEmailDid(request);
    if (!did || did !== offer.did) return NOT_VERIFIED();
    const email = await accountForDid(did);
    const wallet = offer.wallet ? await accountForWallet(offer.wallet) : undefined;
    const before = email?.id === offer.other && wallet?.id === offer.requester;
    const after = !!done && email?.id === done.survivor && wallet?.id === done.survivor;
    if (!before && !after) return NOT_VERIFIED();
  } else {
    const got = await accountOf(request);
    if (!got.ok) return NOT_VERIFIED();
    const id = got.account.user.id;
    if (id !== offer.requester && !(done && id === done.survivor)) return NOT_VERIFIED();
  }

  const answer = (survivor: string, xp: number): NextResponse =>
    NextResponse.json(
      { state: "merged", survivor: survivor === offer.requester ? "this" : "other", xp } satisfies MergeResponse,
      { headers: noStore },
    );
  if (done) return answer(done.survivor, Number(done.moved.survivorXp ?? 0));

  if (!(await takeRatePlace("account-merge", `merge:${offer.requester}`, MERGE_LIMIT_PER_HOUR))) return SLOW_DOWN();
  if (offer.kind === "wallet") {
    // The wallet that proved the other account must still be on it.
    const holder = offer.wallet ? await accountForWallet(offer.wallet) : undefined;
    if (holder?.id !== offer.other) return NextResponse.json({ state: "changed" } satisfies MergeResponse, { headers: noStore });
  }
  const plan = await planMerge(offer.requester, offer.other);
  if (!plan || plan.survivor !== offer.survivor) {
    return NextResponse.json({ state: "changed" } satisfies MergeResponse, { headers: noStore });
  }
  const proofRef = offer.kind === "email" ? `email:${offer.did}` : `wallet:eip155:${offer.wallet ?? ""}`;
  const result = await mergeAccounts({ survivor: plan.survivor, absorbed: plan.absorbed, reason: offer.kind, proofRef });
  if (!result.ok) {
    return NextResponse.json({ state: result.reason === "taken" ? "changed" : "failed" } satisfies MergeResponse, {
      status: result.reason === "taken" ? 200 : 500,
      headers: noStore,
    });
  }
  // A security notice to the account that remains, once per absorbed account (it can be absorbed once, ever).
  if (!result.again) sendNotice({ userId: result.survivor, ref: result.absorbed, notice: { type: "accounts_merged" } });
  return answer(result.survivor, Number(result.moved.survivorXp ?? 0));
}
