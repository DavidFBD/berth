import { NextResponse, type NextRequest } from "next/server";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { parseTargetKey, proofResource, proofStatement, targetKey, type ProofAct, type ProofFamily } from "@/lib/account-proof";
import { normalizeAddress } from "@/lib/identity/caip";
import { parseSiwsMessage } from "@/lib/siws";
import { getSql } from "@/lib/server/db";
import { hubWalletFor, readListingBalances } from "@/lib/server/portfolio";
import { fetchPrivyEmailVerifiedAt } from "@/lib/server/privy";
import { normalizeWallet, type UserRow } from "@/lib/server/accounts";
import { walletsOf } from "@/lib/server/account-wallets";
import type { LinkedWallet } from "@/lib/server/identities";
import { takeRatePlace } from "@/lib/server/oauth/rate-limit";
import { readRewardsCaller, resolveRewardsUser, type RewardsCaller } from "@/lib/server/rewards-route";
import { verifySiwe, type SiweVerifier } from "@/lib/server/siwe";
import { verifySiws, type SiwsVerifier } from "@/lib/server/siws";
import {
  issueAccountNonceToken,
  readAccountNonceToken,
  type AccountAct,
} from "@/lib/server/wallet-session";

/**
 * The shared prologue of the account wallet routes (app/api/account/wallets):
 * who is asking (the rewards caller, a Privy token or a wallet session),
 * a rate limit per account, and the proof: a SIWE made for Berth over a
 * nonce issued to this account for this act and this target, no older than
 * ten minutes, spent once, saying exactly what it is for. Every failure
 * before the proof checks out answers the same 401, so nothing about an
 * address is learnt without its signature.
 */

/** Nonces an account may ask for in an hour. */
export const NONCE_LIMIT_PER_HOUR = 20;
/** Link, home and remove attempts an account may make in an hour. */
export const ACT_LIMIT_PER_HOUR = 20;

export type WalletView = Pick<LinkedWallet, "address" | "family" | "isHome" | "linkedAt">;

export type WalletsResponse = {
  wallets: WalletView[];
  /**
   * The address this request's session proves, when it is a wallet
   * session: removing it would sign the browser out, so the drawer never
   * offers it. Null for an email session.
   */
  signedInWith: string | null;
};

/**
 * Whether the hub wallet derived from `address` holds any listing now, read
 * on chain. Throws when the read fails: unknown is never "empty".
 */
export type HoldingsCheck = (address: string) => Promise<boolean>;

const readHolds: HoldingsCheck = async (address) =>
  Object.keys(await readListingBalances(await hubWalletFor(address))).length > 0;

let holdsCheck: HoldingsCheck = readHolds;
/** Test-only: swap the chain read (null restores it). */
export function setHoldingsCheck(next: HoldingsCheck | null): void {
  holdsCheck = next ?? readHolds;
}

/** "holds", "empty", or "unknown" when the chain could not be read. */
export async function holdingsAt(address: string): Promise<"holds" | "empty" | "unknown"> {
  try {
    return (await holdsCheck(address)) ? "holds" : "empty";
  } catch {
    return "unknown";
  }
}

let verifier: SiweVerifier = verifySiwe;
/** Test-only: swap the SIWE check (null restores the real one). */
export function setSiweVerifier(next: SiweVerifier | null): void {
  verifier = next ?? verifySiwe;
}

let solanaVerifier: SiwsVerifier = verifySiws;
/** Test-only: swap the SIWS check (null restores the real one). */
export function setSiwsVerifier(next: SiwsVerifier | null): void {
  solanaVerifier = next ?? verifySiws;
}

export const NOT_VERIFIED = () => NextResponse.json({ error: "not verified" }, { status: 401 });
const SLOW_DOWN = () => NextResponse.json({ error: "slow down" }, { status: 429 });

type Account = { caller: RewardsCaller; user: UserRow };

export async function accountOf(request: NextRequest): Promise<{ ok: true; account: Account } | { ok: false; response: NextResponse }> {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved;
  return { ok: true, account: { caller: read.caller, user: resolved.user } };
}

export async function walletsResponse(account: Account, extra: Record<string, unknown> = {}): Promise<NextResponse> {
  const wallets = await walletsOf(account.user.id);
  const body: WalletsResponse & Record<string, unknown> = {
    ...extra,
    wallets: wallets.map(({ address, family, isHome, linkedAt }) => ({ address, family, isHome, linkedAt })),
    signedInWith: account.caller.did ? null : account.caller.wallet,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

const ACTS: readonly AccountAct[] = ["link", "home", "unlink"];
/** What each family may do. A home is EVM by definition (the hub wallet is derived from it). */
const FAMILY_ACTS: Record<ProofFamily, readonly AccountAct[]> = { evm: ACTS, solana: ["link", "unlink"] };

/**
 * The target key (lib/account-proof targetKey) for an address in a family:
 * EVM lowercase, Solana base58 exactly as given (case-sensitive, so a
 * miscased address is a different key and is refused, never "fixed").
 */
function keyFor(family: ProofFamily, raw: unknown): string | null {
  if (family === "evm") {
    const address = normalizeWallet(raw);
    return address && /^0x[0-9a-f]{40}$/.test(address) ? address : null;
  }
  const address = typeof raw === "string" ? normalizeAddress("solana", raw) : null;
  return address && address === raw ? targetKey("solana", address) : null;
}

/** How recently an email account must have proved its email to act on its wallets. */
export const PRIVY_FRESH_MS = 10 * 60_000;

/**
 * POST /api/account/wallets/nonce { act, target, family? }: a nonce this
 * account can spend once, on one act, for one target address. `family` is
 * "evm" (the default) or "solana"; a Solana address may be linked or
 * removed, never made home.
 */
export async function issueNonce(request: NextRequest): Promise<NextResponse> {
  const got = await accountOf(request);
  if (!got.ok) return got.response;
  const { act, target, family: rawFamily = "evm" } = got.account.caller.body;
  const family = rawFamily === "evm" || rawFamily === "solana" ? (rawFamily as ProofFamily) : null;
  const address = family ? keyFor(family, target) : null;
  if (typeof act !== "string" || !family || !FAMILY_ACTS[family].includes(act as AccountAct) || !address) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!(await takeRatePlace("account-wallets", `nonce:${got.account.user.id}`, NONCE_LIMIT_PER_HOUR))) return SLOW_DOWN();
  const nonce = generateSiweNonce();
  return NextResponse.json({
    nonce,
    nonceToken: await issueAccountNonceToken(nonce, got.account.user.id, act as AccountAct, address),
  });
}

type Proof = { message: string; signature: string };

function asProof(value: unknown): Proof | null {
  const candidate = value as { message?: unknown; signature?: unknown } | null;
  return candidate && typeof candidate.message === "string" && typeof candidate.signature === "string"
    ? { message: candidate.message, signature: candidate.signature }
    : null;
}

/**
 * The signer of `proof`, as a target key, when it is a SIWE (or, for a
 * Solana address, a SIWS) over `nonce` made for Berth (lib/server/siwe and
 * lib/server/siws check the host and the chain) whose statement and one
 * resource are exactly the ones this act on this target must carry
 * (lib/account-proof). Null otherwise.
 */
async function signerOf(proof: Proof, nonce: string, act: ProofAct, target: string): Promise<string | null> {
  const siws = parseSiwsMessage(proof.message);
  if (siws) {
    if (siws.statement !== proofStatement(act, target)) return null;
    if (siws.resources.length !== 1 || siws.resources[0] !== proofResource(act, target)) return null;
    const signer = await solanaVerifier({ message: proof.message, signature: proof.signature, nonce });
    return signer ? targetKey("solana", signer) : null;
  }
  let fields: ReturnType<typeof parseSiweMessage>;
  try {
    fields = parseSiweMessage(proof.message);
  } catch {
    return null;
  }
  if (fields.statement !== proofStatement(act, target)) return null;
  const resources = fields.resources ?? [];
  if (resources.length !== 1 || resources[0] !== proofResource(act, target)) return null;
  return verifier({ message: proof.message, signature: proof.signature, nonce });
}

/** Spends a nonce once; false when it was spent before. */
async function spend(nonce: string, userId: string, act: AccountAct): Promise<boolean> {
  const rows = (await getSql().query(
    `insert into account_nonces (nonce, user_id, act) values ($1, $2, $3) on conflict do nothing returning nonce`,
    [nonce, userId, act],
  )) as unknown[];
  return rows.length > 0;
}

/**
 * Whether an email account proved its email in the last PRIVY_FRESH_MS:
 * Privy's latest_verified_at on the email account (unix seconds, read as ms
 * by lib/server/privy latestEmailProof), which moves when a code is
 * entered, not when a session silently refreshes (checked against
 * production on 2026-09-29). The access token's iat would not do: it is
 * reissued on every refresh without the person doing anything.
 */
async function privyFresh(did: string): Promise<boolean> {
  const at = await fetchPrivyEmailVerifiedAt(did);
  return at !== null && Date.now() - at <= PRIVY_FRESH_MS;
}

export type ProvedAct =
  /** `signer` and `target` are target keys (lib/account-proof): EVM lowercase, `solana:<base58>`. */
  | { ok: true; account: Account; signer: string; target: string }
  | { ok: false; response: NextResponse };

/**
 * The account behind the request, the target address the nonce was issued
 * for, and the address that signed the proof, or the one uniform refusal.
 *
 * Who must sign what (docs/plans/account-linking.md, fresh proof of both sides):
 * - link: the new address signs the link; the account confirms it too,
 *   with a second SIWE over the same nonce signed by its current home
 *   (`accountProof`), or, for an email account, an email code entered in
 *   the last ten minutes. A lingering session alone never adds a wallet.
 * - home: the current home signs; an account with no home needs a fresh
 *   email proof instead.
 * - unlink: the current home or the address itself signs.
 * The route checks the signer against the home; this checks everything else,
 * and spends the nonce once.
 */
export async function provedAct(request: NextRequest, act: AccountAct): Promise<ProvedAct> {
  const got = await accountOf(request);
  if (!got.ok) return got;
  const { account } = got;
  if (!(await takeRatePlace("account-wallets", `act:${account.user.id}`, ACT_LIMIT_PER_HOUR))) {
    return { ok: false, response: SLOW_DOWN() };
  }
  const { nonceToken, address } = account.caller.body;
  const proof = asProof(account.caller.body);
  if (!proof || typeof nonceToken !== "string") return { ok: false, response: NOT_VERIFIED() };
  const nonce = await readAccountNonceToken(nonceToken);
  if (!nonce || nonce.userId !== account.user.id || nonce.act !== act) return { ok: false, response: NOT_VERIFIED() };
  const targetFamily = parseTargetKey(nonce.target).family;
  if (!FAMILY_ACTS[targetFamily].includes(act)) return { ok: false, response: NOT_VERIFIED() };
  // home and unlink name their target in the body too, and it must be the nonce's.
  if (act !== "link" && keyFor(targetFamily, address) !== nonce.target) return { ok: false, response: NOT_VERIFIED() };
  const signer = await signerOf(proof, nonce.nonce, act, nonce.target);
  if (!signer) return { ok: false, response: NOT_VERIFIED() };
  if (act === "link" && signer !== nonce.target) return { ok: false, response: NOT_VERIFIED() };

  const home = (await walletsOf(account.user.id)).find((wallet) => wallet.family === "evm" && wallet.isHome)?.address ?? null;
  if (act === "link") {
    const confirm = asProof(account.caller.body.accountProof);
    const confirmedBy = confirm ? await signerOf(confirm, nonce.nonce, "link-confirm", nonce.target) : null;
    const byHome = !!home && confirmedBy === home;
    const byEmail = !byHome && !!account.caller.did && (await privyFresh(account.caller.did));
    if (!byHome && !byEmail) {
      return {
        ok: false,
        response: account.caller.did
          ? NextResponse.json({ error: "sign in again" }, { status: 403 })
          : NOT_VERIFIED(),
      };
    }
  } else if (act === "home") {
    const allowed = home ? signer === home : !!account.caller.did && (await privyFresh(account.caller.did));
    if (!allowed) return { ok: false, response: NOT_VERIFIED() };
  } else if (signer !== nonce.target && signer !== home) {
    return { ok: false, response: NOT_VERIFIED() };
  }

  if (!(await spend(nonce.nonce, account.user.id, act))) return { ok: false, response: NOT_VERIFIED() };
  return { ok: true, account, signer, target: nonce.target };
}
