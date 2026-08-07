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

type PrivyLinkedAccount = {
  type: string;
  address?: string;
  email?: string;
  chain_type?: string;
  wallet_client_type?: string;
};

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
 * The DID's embedded EVM wallet, from Privy's own records — the server-side
 * verified answer to "which wallet is this email user", replacing the old
 * client-asserted body field. Null when none is minted yet or the API
 * hiccups; identity then rests on the DID alone, which is fine.
 */
export async function fetchPrivyWallet(did: string): Promise<string | null> {
  const cached = walletCache.get(did);
  if (cached && Date.now() - cached.at < WALLET_CACHE_MS && cached.address) {
    return cached.address;
  }
  const accounts = await fetchPrivyUser(did);
  if (accounts === null) return null; // API hiccup: don't cache the failure
  const embedded = accounts.find(
    (account) =>
      account.type === "wallet" &&
      account.wallet_client_type === "privy" &&
      account.chain_type === "ethereum" &&
      account.address,
  );
  const address = embedded?.address?.toLowerCase() ?? null;
  walletCache.set(did, { address, at: Date.now() });
  return address;
}
