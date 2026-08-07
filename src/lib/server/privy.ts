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
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: "privy.io",
    audience: process.env.PRIVY_APP_ID,
  });
  if (typeof payload.sub !== "string" || !payload.sub.startsWith("did:privy:")) {
    throw new Error("Privy token has no DID subject");
  }
  return payload.sub;
}

type PrivyLinkedAccount = {
  type: string;
  address?: string;
  email?: string;
};

/**
 * The verified email on a Privy user, from the server-side REST API (the
 * access token itself carries only the DID). Returns null when the user has
 * no email-ish account linked yet, or on any API hiccup — email enrichment
 * must never fail a profile request.
 */
export async function fetchPrivyEmail(did: string): Promise<string | null> {
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
    for (const account of user.linked_accounts ?? []) {
      if (account.type === "email" && account.address) return account.address;
      if (account.email) return account.email; // google_oauth and friends
    }
    return null;
  } catch {
    return null;
  }
}
