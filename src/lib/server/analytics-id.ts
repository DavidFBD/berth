import { createHmac } from "node:crypto";
import { accountForDid, accountForWallet } from "@/lib/server/accounts";
import { takeRatePlace } from "@/lib/server/oauth/rate-limit";

/**
 * The only name PostHog ever learns for an account: a keyed SHA-256
 * (HMAC) of the account id under POSTHOG_ID_SALT, a secret that never
 * leaves the server. Never the raw id, an email, a wallet or a username.
 * Without the salt there is no name, and analytics stays anonymous.
 */
export function analyticsIdFor(accountId: string, salt: string | undefined = process.env.POSTHOG_ID_SALT): string | null {
  if (!salt || salt.length < 16 || !accountId) return null;
  return createHmac("sha256", salt).update(`berth-account:${accountId}`).digest("hex");
}

/** How often one caller may ask for its name; the client asks about once per page load. */
export const ANALYTICS_ID_PER_HOUR = 60;

export type AnalyticsIdAnswer = { ok: true; id: string | null } | { ok: false; status: 429 };

/**
 * The caller's name, read only: the account its verified identity already
 * signs in to, never a new one (an identity with no account yet is simply
 * anonymous). Limited per caller.
 */
export async function analyticsIdOf(
  caller: { did: string | null; wallet: string | null },
  {
    allowed = (key: string) => takeRatePlace("analytics-id", key, ANALYTICS_ID_PER_HOUR),
    lookup = async (who: { did: string | null; wallet: string | null }) =>
      (who.did ? await accountForDid(who.did) : undefined) ?? (who.wallet ? await accountForWallet(who.wallet) : undefined),
    salt,
  }: {
    allowed?: (key: string) => Promise<boolean>;
    lookup?: (who: { did: string | null; wallet: string | null }) => Promise<{ id: string } | undefined>;
    salt?: string;
  } = {},
): Promise<AnalyticsIdAnswer> {
  const key = caller.did ?? caller.wallet;
  if (!key) return { ok: true, id: null };
  if (!(await allowed(key))) return { ok: false, status: 429 };
  const account = await lookup(caller);
  return { ok: true, id: account ? analyticsIdFor(account.id, salt ?? process.env.POSTHOG_ID_SALT) : null };
}
