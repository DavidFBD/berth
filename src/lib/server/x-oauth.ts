import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/server/db";

/**
 * Berth's own X account's OAuth 2.0 user token, for posting
 * (lib/server/x-autopost). X's access tokens last about two hours and its
 * refresh tokens rotate on every use: the refresh token in the environment
 * is good exactly once. So the newest pair lives in the database
 * (x_oauth_tokens, one row), seeded from OAUTH_ACCESS_TOKEN and
 * OAUTH_REFRESH_TOKEN only while the table is empty, or again when the
 * stored pair is dead and the environment carries a different refresh
 * token (a fresh authorisation).
 *
 * A refresh is taken under a lease on the row (`refreshing_at`, claimed by
 * one conditional update; Neon over HTTP has no session to hold a `for
 * update` in), so two runs can never spend the same refresh token. The new
 * pair is written before anything else is done with it.
 *
 * Tokens are stored encrypted (AES-256-GCM, a key derived from X_TOKEN_KEY,
 * or from X_CLIENT_SECRET when that is unset), so the database alone cannot
 * post. Nothing here ever
 * logs or returns a token except to the caller that sends the post.
 */

export const TOKEN_URL = "https://api.x.com/2/oauth2/token";
/** A token this close to expiry is refreshed first. */
export const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
/** A refresh lease older than this is taken to have died. */
export const REFRESH_LEASE_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

type Env = Record<string, string | undefined>;
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type TokenResult = { ok: true; accessToken: string } | { ok: false; reason: string };

/**
 * The sealing key: from X_TOKEN_KEY when it is set, so rotating the client
 * secret leaves the stored pair readable; otherwise from X_CLIENT_SECRET.
 * Changing whichever is used makes the stored pair unreadable, and the
 * account must be authorised again.
 */
function key(env: Env): Buffer | null {
  const own = env.X_TOKEN_KEY?.trim();
  if (own) return createHash("sha256").update(`berth x oauth tokens key v1\0${own}`).digest();
  const secret = env.X_CLIENT_SECRET;
  if (!secret) return null;
  return createHash("sha256").update(`berth x oauth tokens v1\0${secret}`).digest();
}

/** The last error a pair dies of when the sealing key changed. */
export const UNREADABLE = "stored refresh token unreadable";

export function sealToken(plain: string, env: Env = process.env): string {
  const k = key(env);
  if (!k) throw new Error("X_TOKEN_KEY and X_CLIENT_SECRET not set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${body.toString("base64")}`;
}

/** The token, or null when it cannot be read (another key, a damaged value). */
export function openToken(sealed: string, env: Env = process.env): string | null {
  const k = key(env);
  const parts = sealed.split(":");
  if (!k || parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(parts[1], "base64"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const at = (ms: number) => new Date(ms).toISOString();
const msOf = (value: unknown): number | undefined =>
  value === null || value === undefined ? undefined : value instanceof Date ? value.getTime() : Date.parse(String(value));

type Row = {
  access_token: string;
  refresh_token: string;
  expires_at: unknown;
  dead: boolean;
  seed_fingerprint: string | null;
};

async function readRow(): Promise<Row | undefined> {
  const rows = (await getSql().query(
    `select access_token, refresh_token, expires_at, dead, seed_fingerprint from x_oauth_tokens where id = 1`,
  )) as Row[];
  return rows[0];
}

/**
 * Seeds the row from the environment while there is none, or replaces a
 * dead pair when the environment carries a refresh token it was not seeded
 * from. The seeded access token's age is unknown, so it is refreshed first.
 */
async function seed(env: Env, now: number): Promise<void> {
  const access = env.OAUTH_ACCESS_TOKEN;
  const refresh = env.OAUTH_REFRESH_TOKEN;
  if (!access || !refresh || !key(env)) return;
  const print = fingerprint(refresh);
  await getSql().query(
    `insert into x_oauth_tokens (id, access_token, refresh_token, expires_at, seed_fingerprint, updated_at)
     values (1, $1, $2, null, $3, $4::timestamptz)
     on conflict (id) do update set access_token = excluded.access_token, refresh_token = excluded.refresh_token,
       expires_at = null, dead = false, last_error = null, refreshing_at = null,
       seed_fingerprint = excluded.seed_fingerprint, updated_at = excluded.updated_at
     where x_oauth_tokens.dead and x_oauth_tokens.seed_fingerprint is distinct from excluded.seed_fingerprint`,
    [sealToken(access, env), sealToken(refresh, env), print, at(now)],
  );
}

async function recordError(message: string, now: number, { dead = false } = {}): Promise<void> {
  await getSql().query(
    `update x_oauth_tokens set refreshing_at = null, last_error = $1, dead = dead or $2, updated_at = $3::timestamptz where id = 1`,
    [message, dead, at(now)],
  );
}

/**
 * Spends the stored refresh token for a new pair, under the lease. Null
 * with a reason when another run holds the lease, X refused, or the answer
 * could not be read; a refused token (400/401) marks the pair dead.
 */
async function refresh(env: Env, now: number, fetchImpl: FetchLike): Promise<TokenResult> {
  const claimed = (await getSql().query(
    `update x_oauth_tokens set refreshing_at = $1::timestamptz
     where id = 1 and not dead and (refreshing_at is null or refreshing_at < $2::timestamptz)
     returning refresh_token`,
    [at(now), at(now - REFRESH_LEASE_MS)],
  )) as { refresh_token: string }[];
  if (claimed.length === 0) return { ok: false, reason: "refresh held by another run, or token dead" };
  const refreshToken = openToken(claimed[0].refresh_token, env);
  if (!refreshToken) {
    await recordError(UNREADABLE, now, { dead: true });
    return { ok: false, reason: UNREADABLE };
  }
  const clientId = env.X_CLIENT_ID ?? "";
  const basic = Buffer.from(`${clientId}:${env.X_CLIENT_SECRET ?? ""}`).toString("base64");
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // The token may or may not have been spent; the lease runs out and the next run tries.
    const message = `refresh request failed: ${error instanceof Error ? error.name : "error"}`;
    await recordError(message, now);
    return { ok: false, reason: message };
  }
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !body.access_token) {
    const message = `refresh refused: ${response.status}${body.error ? ` ${String(body.error).slice(0, 60)}` : ""}`;
    await recordError(message, now, { dead: response.status === 400 || response.status === 401 });
    return { ok: false, reason: message };
  }
  const fresh = body.access_token;
  const expiresAt = now + (Number(body.expires_in) > 0 ? Number(body.expires_in) : 7200) * 1000;
  const save = () =>
    getSql().query(
      `update x_oauth_tokens set access_token = $1, refresh_token = $2, expires_at = $3::timestamptz,
         refreshing_at = null, refreshed_at = $4::timestamptz, last_error = null, updated_at = $4::timestamptz
       where id = 1`,
      [
        sealToken(fresh, env),
        // X rotates it every time; should an answer ever lack one, the old one is kept.
        body.refresh_token ? sealToken(body.refresh_token, env) : claimed[0].refresh_token,
        at(expiresAt),
        at(now),
      ],
    );
  // X has already spent the old refresh token: losing the new one means authorising again, so the save is tried twice.
  try {
    await save();
  } catch {
    try {
      await save();
    } catch (error) {
      console.warn("[x-oauth] rotated token could not be saved; authorise again if the next refresh is refused:", error instanceof Error ? error.name : "error");
    }
  }
  return { ok: true, accessToken: fresh };
}

/**
 * An access token good for the next few minutes, refreshing (and rotating)
 * when the stored one is near its end or `force` says X refused it.
 */
export async function accessToken({
  env = process.env,
  now = Date.now(),
  fetchImpl = fetch,
  force = false,
}: { env?: Env; now?: number; fetchImpl?: FetchLike; force?: boolean } = {}): Promise<TokenResult> {
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET) return { ok: false, reason: "X_CLIENT_ID or X_CLIENT_SECRET not set" };
  await seed(env, now);
  const row = await readRow();
  if (!row) return { ok: false, reason: "no token stored and none in the environment" };
  if (row.dead) return { ok: false, reason: "stored token dead; authorise again and set OAUTH_REFRESH_TOKEN" };
  const expiresAt = msOf(row.expires_at);
  if (!force && expiresAt !== undefined && expiresAt - now > EXPIRY_MARGIN_MS) {
    const token = openToken(row.access_token, env);
    if (token) return { ok: true, accessToken: token };
  }
  return refresh(env, now, fetchImpl);
}

/** For the staff page: when the token was last refreshed and what last went wrong, never the token. */
export async function tokenStatus(): Promise<{
  stored: boolean;
  refreshedAt?: number;
  expiresAt?: number;
  dead: boolean;
  /** Dead because the sealing key changed, not because X refused it. */
  unreadable?: boolean;
  lastError?: string;
}> {
  const rows = (await getSql().query(
    `select refreshed_at, expires_at, dead, last_error from x_oauth_tokens where id = 1`,
  )) as { refreshed_at: unknown; expires_at: unknown; dead: boolean; last_error: string | null }[];
  const row = rows[0];
  if (!row) return { stored: false, dead: false };
  return {
    stored: true,
    refreshedAt: msOf(row.refreshed_at),
    expiresAt: msOf(row.expires_at),
    dead: row.dead,
    unreadable: row.dead && row.last_error === UNREADABLE,
    lastError: row.last_error ?? undefined,
  };
}
