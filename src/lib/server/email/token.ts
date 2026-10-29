import { hkdfSync } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { isRetiredKind, isSwitchableKind, type RetiredKind, type SwitchableKind } from "@/lib/email-kinds";

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

/**
 * A key for another purpose from the same server secret, separated by
 * `purpose` (HKDF info), so it never equals the unsubscribe token's key:
 * for HMACs that must not be computable without the secret.
 */
export function emailHmacKey(purpose: string, env: NodeJS.ProcessEnv = process.env): Buffer {
  return Buffer.from(hkdfSync("sha256", secret(env), "berth-email", purpose, 32));
}

/** `expired` is set only when the caller allowed an expired token (see readUnsubscribeToken). */
export type UnsubscribeClaims = { userId: string; kind: SwitchableKind; expired?: true };
/** A sound token for a kind Berth no longer sends (lib/email-kinds RETIRED_KINDS): nothing to switch. */
export type RetiredClaims = { userId: string; retired: RetiredKind };

/** Ten years in seconds: how far past its expiry an authentic token is still read when the caller allows it. */
const EXPIRED_GRACE_SECONDS = 10 * 365 * 86_400;

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

/**
 * The claims, or null for anything expired, altered, foreign or malformed.
 * A sound token for a retired kind reads as RetiredClaims, so its link
 * still lands calmly instead of saying it is broken.
 *
 * With `allowExpired`, an authentic token past its 180 days still reads,
 * marked `expired`, so that it can turn a kind OFF (an old marketing
 * email's link must still opt out) and never ON: the caller refuses the
 * on. Anything altered, foreign or malformed is null either way.
 */
export async function readUnsubscribeToken(
  token: unknown,
  { now = new Date(), env = process.env, allowExpired = false }: { now?: Date; env?: NodeJS.ProcessEnv; allowExpired?: boolean } = {},
): Promise<UnsubscribeClaims | RetiredClaims | null> {
  if (typeof token !== "string" || token.length === 0 || token.length > 1024) return null;
  let expired = false;
  try {
    let payload;
    try {
      ({ payload } = await jwtDecrypt(token, tokenKey(env), { currentDate: now }));
    } catch (error) {
      if (!allowExpired || (error as { code?: string })?.code !== "ERR_JWT_EXPIRED") return null;
      expired = true;
      ({ payload } = await jwtDecrypt(token, tokenKey(env), { currentDate: now, clockTolerance: EXPIRED_GRACE_SECONDS }));
    }
    if (payload.p !== "unsub" || typeof payload.u !== "string") return null;
    if (isRetiredKind(payload.k)) return { userId: payload.u, retired: payload.k };
    if (!isSwitchableKind(payload.k)) return null;
    return expired ? { userId: payload.u, kind: payload.k, expired: true } : { userId: payload.u, kind: payload.k };
  } catch {
    return null;
  }
}
