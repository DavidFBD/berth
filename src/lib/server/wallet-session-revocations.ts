import { getSql } from "@/lib/server/db";
import { readWalletSession } from "@/lib/server/wallet-session";

/**
 * Signing out ends a wallet session on the server, not only in the browser.
 * Holding a session token is the authority to end it: the token is verified
 * (our signature, purpose, not expired) and its id recorded. A token from
 * before session ids existed has none and cannot be revoked; it expires on
 * its own within the week. Idempotent: revoking twice is one row.
 */

/** At most this many tokens per sign out (a browser pockets one per wallet). */
export const MAX_REVOKE = 20;

export async function revokeWalletSessions(tokens: readonly unknown[]): Promise<number> {
  let revoked = 0;
  for (const token of tokens.slice(0, MAX_REVOKE)) {
    if (typeof token !== "string" || token.length > 4096) continue;
    const session = await readWalletSession(token);
    if (!session?.jti) continue;
    await getSql().query(
      `insert into wallet_session_revocations (jti, address, expires_at)
       values ($1, $2, to_timestamp($3 / 1000.0))
       on conflict (jti) do nothing`,
      [session.jti, session.address, session.expiresAt],
    );
    revoked += 1;
  }
  // Rows outlive their token for nothing: prune the expired, cheaply, here,
  // and only when this call wrote one, so an empty call costs no write.
  if (revoked > 0) {
    await getSql()
      .query(`delete from wallet_session_revocations where expires_at < now()`)
      .catch(() => undefined);
  }
  return revoked;
}

/**
 * Whether this session id was signed out. A read that fails throws: the
 * caller answers 503 (never 401, which would make the browser forget a
 * good session, and never a silent yes, which would let a signed out one
 * through). The browser keeps its session and tries again later.
 */
export async function walletSessionRevoked(jti: string | null): Promise<boolean> {
  if (!jti) return false;
  const rows = (await getSql().query(`select 1 from wallet_session_revocations where jti = $1`, [jti])) as unknown[];
  return rows.length > 0;
}
