import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Privy access-token verification, straight against the app's JWKS endpoint
 * (no SDK: @privy-io/server-auth is deprecated and this is one JWT check).
 * The JWKS set caches keys internally, so keep one instance per runtime.
 */
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(process.env.PRIVY_JWKS_ENDPOINT!));
  }
  return _jwks;
}

/**
 * Resolves the caller's Privy DID from a Bearer token, or null when no
 * Authorization header is present (external-wallet users have no Privy
 * session). Throws on a token that is present but invalid — callers turn
 * that into a 401 rather than silently downgrading to anonymous.
 */
export async function verifyPrivyAuth(
  authorization: string | null,
): Promise<string | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: "privy.io",
      audience: process.env.PRIVY_APP_ID,
    });
    if (
      typeof payload.sub !== "string" ||
      !payload.sub.startsWith("did:privy:")
    ) {
      throw new Error("Privy token has no DID subject");
    }
    return payload.sub;
  } catch (error) {
    // Every rejection becomes a 401 upstream, and a silent 401 hides the
    // whole rewards UI — this line is what makes that diagnosable from
    // `vercel logs` (it already cost one evening to learn).
    console.error(
      "[privy-auth] token verification failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    );
    throw error;
  }
}

export type PrivyLinkedAccount = {
  type: string;
  address?: string;
  email?: string;
  chain_type?: string;
  wallet_client_type?: string;
  connector_type?: string;
  /**
   * Unix SECONDS (Privy's REST API, @privy-io/api-types `number | null`):
   * when the person last proved this account. It moves on each fresh proof
   * (an email code entered, an OAuth login), not on a silent session
   * refresh: production on 2026-09-29 showed email accounts with
   * first_verified_at 2026-07-31 and latest_verified_at 2026-09-21.
   */
  latest_verified_at?: number | null;
};

/**
 * Whether a linked wallet is one Privy holds for the user. Two client types
 * name it ("privy" and, on newer wallets, "privy-v2"), and the connector
 * type says "embedded" for both; any of the three is enough.
 */
export function isEmbeddedWallet(account: PrivyLinkedAccount): boolean {
  return (
    account.wallet_client_type === "privy" ||
    account.wallet_client_type === "privy-v2" ||
    account.connector_type === "embedded"
  );
}

/**
 * The verified email on a Privy user, from the server-side REST API (the
 * access token itself carries only the DID). Returns null when the user has
 * no email-ish account linked yet, or on any API hiccup — email enrichment
 * must never fail a profile request.
 */
async function fetchPrivyUser(
  did: string,
): Promise<PrivyLinkedAccount[] | null> {
  const appId = process.env.PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) return null;

  try {
    const response = await fetch(
      `https://auth.privy.io/api/v1/users/${encodeURIComponent(did)}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`,
          "privy-app-id": appId,
        },
        // Profile data changes rarely; don't let Next cache an early
        // no-email answer forever either.
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    const user = (await response.json()) as {
      linked_accounts?: PrivyLinkedAccount[];
    };
    return user.linked_accounts ?? [];
  } catch {
    return null;
  }
}

/**
 * When the person last entered a code sent to their email (Privy's own
 * email account only; an OAuth login such as Google never counts, see
 * latestEmailProof), in epoch ms, or null when unknown or on any API
 * hiccup. The account's wallet acts and merges
 * (lib/server/account-wallets-route, account-merge-route) ask for this to
 * be recent: a lingering session on a shared browser is not the person.
 */
export async function fetchPrivyEmailVerifiedAt(did: string): Promise<number | null> {
  const accounts = await fetchPrivyUser(did);
  return accounts ? latestEmailProof(accounts) : null;
}

/**
 * Each of Privy's own email accounts on the user, with when a code sent to
 * it was last entered (epoch ms, null when unknown); null on any API
 * hiccup. For a check that the code went to one particular address
 * (lib/server/staff-auth requireFreshStaff).
 */
export async function fetchPrivyEmailProofs(did: string): Promise<{ address: string; at: number | null }[] | null> {
  const accounts = await fetchPrivyUser(did);
  if (!accounts) return null;
  return accounts
    .filter((account) => account.type === "email" && typeof account.address === "string")
    .map((account) => ({
      address: account.address!.trim().toLowerCase(),
      at: typeof account.latest_verified_at === "number" && Number.isFinite(account.latest_verified_at) ? account.latest_verified_at * 1000 : null,
    }));
}

/**
 * The newest latest_verified_at of the user's email accounts, in epoch ms
 * (Privy gives seconds): when a code sent to the inbox was last entered.
 * Only Privy's own `email` account counts. A Google (or any other OAuth)
 * login carries an email too, but proves a session at that provider, not a
 * code entered here, so it never makes an email proof fresh.
 */
export function latestEmailProof(accounts: readonly PrivyLinkedAccount[]): number | null {
  let latest: number | null = null;
  for (const account of accounts) {
    if (account.type !== "email") continue;
    const seconds = account.latest_verified_at;
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) continue;
    const ms = seconds * 1000;
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

/** How recently an email account must have proved its email to act on its wallets. */
export const PRIVY_FRESH_MS = 10 * 60_000;

/** Whether a proof at `at` (ms, from latestEmailProof) is still fresh at `now`. */
export function emailProofFresh(at: number | null, now: number): boolean {
  return at !== null && now - at <= PRIVY_FRESH_MS;
}

export async function fetchPrivyEmail(did: string): Promise<string | null> {
  const accounts = await fetchPrivyUser(did);
  for (const account of accounts ?? []) {
    if (account.type === "email" && account.address) return account.address;
    if (account.email) return account.email; // google_oauth and friends
  }
  return null;
}

/**
 * An embedded wallet address never changes once minted, so a warm serverless
 * container can skip the REST round-trip on every XP request after the first.
 */
const walletCache = new Map<string, { address: string | null; at: number }>();
const WALLET_CACHE_MS = 24 * 60 * 60 * 1000;

/**
 * The EVM address this Privy user's account belongs to, from Privy's own
 * records: the server-side verified answer to "who is this DID", replacing
 * the old client-asserted body field.
 *
 * Embedded first, then any linked external wallet, and the order is the
 * whole point. An email user's account is their embedded wallet, so that
 * must win even when they have also linked an external one, because
 * lib/account gives the money account to the embedded address in email mode
 * and the two must name the same person.
 *
 * The external fallback exists because a Privy session can now be created by
 * signing with an external wallet (hooks/use-link-email), and that user has
 * no embedded wallet at all. Without the fallback this returned null, the
 * claim path in accounts.ts never fired for want of an address, and a user
 * who had just proved ownership of the wallet holding their positions was
 * handed a brand new empty account instead. That happened to a real account
 * on 2026-09-21 and is what this fallback exists to prevent.
 *
 * Null when the user has no EVM wallet at all. With several external
 * wallets and no embedded one the first Privy lists wins; today only one can
 * be linked (SIWE is the only way in, and there is no link-a-wallet flow), so
 * that choice is not yet reachable.
 */
export function pickAccountWallet(
  accounts: readonly PrivyLinkedAccount[],
): string | null {
  const evmWallets = accounts.filter(
    (account) =>
      account.type === "wallet" &&
      account.chain_type === "ethereum" &&
      account.address,
  );
  const embedded = evmWallets.find(isEmbeddedWallet);
  return (embedded ?? evmWallets[0])?.address?.toLowerCase() ?? null;
}

/**
 * `ok: false` means Privy could not be asked, which is not the same as the
 * user having no wallet. The difference is an account: carrying on without
 * the address once created a fresh empty row for a wallet owner whose real
 * row was one lookup away, and that row then won every later sync. So the
 * caller refuses the request instead (rewards-route answers 503).
 */
export type PrivyWalletLookup = { ok: true; address: string | null } | { ok: false };

const embeddedCache = new Map<string, { address: string | null; at: number }>();

/**
 * The EVM wallet Privy holds for this user (its embedded wallet), never an
 * external one, lowercase; null when it has none or Privy cannot be asked.
 * The wallets list uses it to say which linked address only an email sign
 * in can sign for (after a merge, a wallet session cannot).
 */
export async function fetchPrivyEmbeddedWallet(did: string): Promise<string | null> {
  const cached = embeddedCache.get(did);
  if (cached && Date.now() - cached.at < WALLET_CACHE_MS && cached.address) return cached.address;
  const accounts = await fetchPrivyUser(did);
  if (accounts === null) return null;
  const address =
    accounts
      .find((account) => account.type === "wallet" && account.chain_type === "ethereum" && account.address && isEmbeddedWallet(account))
      ?.address?.toLowerCase() ?? null;
  embeddedCache.set(did, { address, at: Date.now() });
  return address;
}

export async function fetchPrivyWallet(did: string): Promise<PrivyWalletLookup> {
  const cached = walletCache.get(did);
  if (cached && Date.now() - cached.at < WALLET_CACHE_MS && cached.address) {
    return { ok: true, address: cached.address };
  }
  const accounts = await fetchPrivyUser(did);
  if (accounts === null) return { ok: false }; // don't cache the failure
  const address = pickAccountWallet(accounts);
  walletCache.set(did, { address, at: Date.now() });
  return { ok: true, address };
}
