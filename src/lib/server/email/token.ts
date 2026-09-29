import { hkdfSync } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { isSwitchableKind, type SwitchableKind } from "@/lib/email-kinds";

/**
 * The unsubscribe token: which account and which kind of email, sealed.
 *
 * It rides in a URL (List-Unsubscribe and the footer link), so it carries
 * no email address and no readable id: the claims are encrypted and
 * authenticated (JWE, direct A256GCM), so the token is opaque to anyone
 * holding it and cannot be forged or altered. The key is derived (HKDF)
 * from EMAIL_TOKEN_SECRET, or the deployment's session secret when that is
 * unset, so production needs no new variable to start.
 */

/** Long enough that an old email's link still works, short enough to age out. */
export const UNSUBSCRIBE_TTL_DAYS = 180;

function secret(env: NodeJS.ProcessEnv): string {
  const value = env.EMAIL_TOKEN_SECRET ?? env.SESSION_SECRET ?? env.PRIVY_APP_SECRET;
  if (!value) throw new Error("unsubscribe links need EMAIL_TOKEN_SECRET (or SESSION_SECRET) set");
  return value;
}

const keys = new Map<string, Uint8Array>();
function tokenKey(env: NodeJS.ProcessEnv): Uint8Array {
  const raw = secret(env);
  let key = keys.get(raw);
  if (!key) {
    key = new Uint8Array(hkdfSync("sha256", raw, "berth-email", "unsubscribe-v1", 32));
    keys.set(raw, key);
  }
  return key;
}

export type UnsubscribeClaims = { userId: string; kind: SwitchableKind };

export async function issueUnsubscribeToken(
  claims: UnsubscribeClaims,
  { now = new Date(), env = process.env }: { now?: Date; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new EncryptJWT({ p: "unsub", u: claims.userId, k: claims.kind })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + UNSUBSCRIBE_TTL_DAYS * 86_400)
    .encrypt(tokenKey(env));
}

/** The claims, or null for anything expired, altered, foreign or malformed. */
export async function readUnsubscribeToken(
  token: unknown,
  { now = new Date(), env = process.env }: { now?: Date; env?: NodeJS.ProcessEnv } = {},
): Promise<UnsubscribeClaims | null> {
  if (typeof token !== "string" || token.length === 0 || token.length > 1024) return null;
  try {
    const { payload } = await jwtDecrypt(token, tokenKey(env), { currentDate: now });
    if (payload.p !== "unsub" || typeof payload.u !== "string" || !isSwitchableKind(payload.k)) return null;
    return { userId: payload.u, kind: payload.k };
  } catch {
    return null;
  }
}
