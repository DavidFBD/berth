import { getSql } from "@/lib/server/db";
import { TERMS_VERSION } from "@/lib/legal-version";

/**
 * Which version of the terms each account accepted, and when
 * (terms_acceptances): one row per account and version, written once by
 * the terms sheet's Accept (components/terms-sheet). No row for the
 * current version, and the next buy asks again (lib/terms-gate). Nothing
 * else is kept: no IP, no device.
 */

export type TermsStatus = {
  version: string;
  accepted: boolean;
  acceptedAt: string | null;
  /** The record could not be read, so the gate lets the person through for now. */
  failedOpen?: true;
};

/**
 * Whether this account accepted the current terms. Fails open: if the
 * record cannot be read (the table missing before db:push, the database
 * down), the person counts as not needing to accept right now, and the
 * failure is logged. A buy is never blocked by an infrastructure error.
 */
export async function termsStatus(userId: string, version: string = TERMS_VERSION): Promise<TermsStatus> {
  try {
    const rows = (await getSql().query(
      `select accepted_at from terms_acceptances where user_id = $1::uuid and version = $2`,
      [userId, version],
    )) as { accepted_at: string | Date }[];
    const at = rows[0]?.accepted_at;
    return { version, accepted: Boolean(at), acceptedAt: at ? new Date(at).toISOString() : null };
  } catch (error) {
    console.error("[terms] acceptance read failed, letting the person through", error instanceof Error ? error.message : error);
    return { version, accepted: true, acceptedAt: null, failedOpen: true };
  }
}

/**
 * Record the account's yes to `version`. Only the current version can be
 * accepted (a page left open across a release must ask again): "refused"
 * for any other. A second yes keeps the first time. If the write fails
 * (the table missing, the database down), it fails quietly: "failed" is
 * logged and the person goes on, as the read would have let them.
 */
export async function acceptTerms(userId: string, version: unknown): Promise<"recorded" | "refused" | "failed"> {
  if (version !== TERMS_VERSION) return "refused";
  try {
    await getSql().query(
      `insert into terms_acceptances (user_id, version) values ($1::uuid, $2) on conflict (user_id, version) do nothing`,
      [userId, version],
    );
    return "recorded";
  } catch (error) {
    console.error("[terms] acceptance write failed, letting the person through", error instanceof Error ? error.message : error);
    return "failed";
  }
}
