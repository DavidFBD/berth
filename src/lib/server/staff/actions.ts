import { getSql } from "@/lib/server/db";
import { revokeUserGrant } from "@/lib/server/oauth/tokens";
import { retryOneSend } from "@/lib/server/email/send";
import { auditCte, recordStaff, type StaffContext } from "@/lib/server/staff-gate";
import { isTrackedService, type TrackedService } from "@/lib/server/staff/budgets";
import { parseAmount } from "@/lib/staff/budget-math";
import { NOTICE_ADDRESS_SQL } from "@/lib/server/staff/users";

/**
 * The staff area's only writes (docs/adr/0008-staff-area.md). Each one is
 * small, reversible or harmless, and recorded in staff_audit with the
 * reason the admin gave, before it reports success. None signs anything,
 * moves money, or edits a balance or XP; there is no "sign in as".
 *
 * A write that is one statement carries its audit row in that statement,
 * so both commit or neither does. Revoking a grant (several statements in
 * lib/server/oauth/tokens) and sending a notice again (a provider call)
 * cannot share a transaction: their audit row is written first, so an
 * action that cannot be recorded does not happen, and the outcome follows
 * in a second row.
 */

export const STAFF_ACTIONS = [
  "suppress",
  "unsuppress",
  "hide",
  "unhide",
  "revoke",
  "retry",
  "ineligible",
  "eligible",
  "budget",
] as const;
export type StaffActionName = (typeof STAFF_ACTIONS)[number];

export function isStaffAction(value: unknown): value is StaffActionName {
  return typeof value === "string" && (STAFF_ACTIONS as readonly string[]).includes(value);
}

export type StaffActionInput = {
  action: StaffActionName;
  reason: string;
  userId?: string | null;
  grantId?: string | null;
  sendId?: string | null;
  service?: string | null;
  balanceUsd?: unknown;
  threshold?: unknown;
};

export type StaffActionResult = { ok: true; changed: boolean; outcome?: string } | { ok: false; error: "bad_request" | "not_found" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REASON_MIN = 4;
export const REASON_MAX = 300;

/** A reason as typed: trimmed to one line, at least four characters, at most three hundred. */
export function cleanReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length >= REASON_MIN ? flat.slice(0, REASON_MAX) : null;
}

async function accountExists(userId: string): Promise<boolean> {
  const rows = (await getSql().query(`select 1 from users where id = $1`, [userId])) as unknown[];
  return rows.length > 0;
}

/** Where the account's notices go: its primary email, else the users.email column (NOTICE_ADDRESS_SQL). */
async function primaryAddress(userId: string): Promise<string | null> {
  const rows = (await getSql().query(`select (${NOTICE_ADDRESS_SQL}) as value`, [userId])) as { value: string | null }[];
  return rows[0]?.value ?? null;
}

export async function runStaffAction(staff: StaffContext, input: StaffActionInput): Promise<StaffActionResult> {
  const reason = cleanReason(input.reason);
  if (!reason || !isStaffAction(input.action)) return { ok: false, error: "bad_request" };
  const sql = getSql();
  const userId = typeof input.userId === "string" && UUID.test(input.userId) ? input.userId.toLowerCase() : null;
  const needsUser = input.action !== "retry" && input.action !== "budget";
  if (needsUser && (!userId || !(await accountExists(userId)))) return { ok: false, error: "not_found" };
  const target = `user:${userId}`;

  // Each write below that is one statement carries its own audit row in
  // that statement (auditCte), so the change and its record commit
  // together or not at all.
  const run = async (action: string, detail: Record<string, unknown>, statement: (audit: string, params: unknown[]) => string, params: unknown[]) => {
    const audit = auditCte(params, staff.userId, action, target, detail);
    return (await sql.query(statement(audit, params), params)) as { changed: boolean }[];
  };

  switch (input.action) {
    case "suppress":
    case "unsuppress": {
      const address = await primaryAddress(userId!);
      if (!address) return { ok: false, error: "not_found" };
      const rows = await run(`email_${input.action}`, { reason }, (audit) =>
        input.action === "suppress"
          ? `with audit as (${audit}),
                 changed as (insert into email_suppressions (address, reason) select $1, 'staff' from audit on conflict (address) do nothing returning 1)
             select exists (select 1 from changed) as changed from audit`
          : `with audit as (${audit}),
                 changed as (delete from email_suppressions where address = $1 and reason = 'staff' and exists (select 1 from audit) returning 1)
             select exists (select 1 from changed) as changed from audit`,
      [address]);
      return { ok: true, changed: Boolean(rows[0]?.changed) };
    }
    case "hide":
    case "unhide": {
      // Staff hide only a card that is shown, and show again only a card
      // staff hid (profiles.staff_hidden_at): a person's own "Hide my
      // card" is theirs alone. The name kept for friends' lists
      // (hidden_handle) clears only where an email is on the account, as
      // the social_email_change trigger keeps it.
      const hide = input.action === "hide";
      const rows = await run(`profile_${input.action}`, { reason }, (audit, params) => {
        const n = params.length;
        const update = hide
          ? `update profiles set visible = false, hidden_at = now(), staff_hidden_at = now(),
               hidden_handle = (select handle from handles where user_id = $1), updated_at = now()
             where user_id = $1 and visible and exists (select 1 from audit)
             returning user_id`
          : `update profiles set visible = true, hidden_at = null, staff_hidden_at = null,
               hidden_handle = case when exists (select 1 from users e where e.id = $1 and e.email is not null) then null else hidden_handle end,
               updated_at = now()
             where user_id = $1 and not visible and staff_hidden_at is not null and exists (select 1 from audit)
             returning user_id`;
        return `with audit as (${audit}),
                    changed as (${update}),
                    trail as (
                      insert into social_audit (actor_id, action, target_id, meta)
                      select $${n - 3}::uuid, $2, user_id, '{"by":"staff"}'::jsonb from changed)
                select exists (select 1 from changed) as changed from audit`;
      }, [userId, input.action]);
      return { ok: true, changed: Boolean(rows[0]?.changed) };
    }
    case "revoke": {
      const grantId = typeof input.grantId === "string" && UUID.test(input.grantId) ? input.grantId : null;
      if (!grantId) return { ok: false, error: "bad_request" };
      const owned = (await sql.query(`select 1 from oauth_grants where id = $1 and user_id = $2`, [grantId, userId])) as unknown[];
      if (owned.length === 0) return { ok: false, error: "not_found" };
      await recordStaff(staff, "grant_revoke", `grant:${grantId}`, { reason, user: userId });
      const changed = await revokeUserGrant(userId!, grantId);
      return { ok: true, changed };
    }
    case "retry": {
      const sendId = typeof input.sendId === "string" && UUID.test(input.sendId) ? input.sendId : null;
      if (!sendId) return { ok: false, error: "bad_request" };
      const exists = (await sql.query(`select 1 from email_sends where id = $1`, [sendId])) as unknown[];
      if (exists.length === 0) return { ok: false, error: "not_found" };
      await recordStaff(staff, "email_retry", `send:${sendId}`, { reason });
      const outcome = await retryOneSend(sendId);
      await recordStaff(staff, "email_retry_outcome", `send:${sendId}`, { outcome });
      return { ok: true, changed: outcome === "sent", outcome };
    }
    case "ineligible":
    case "eligible": {
      const off = input.action === "ineligible";
      const rows = await run(off ? "campaign_ineligible" : "campaign_eligible", { reason }, (audit) =>
        off
          ? `with audit as (${audit}),
                 changed as (update users set campaign_ineligible_at = now(), campaign_ineligible_by = $2
                              where id = $1 and campaign_ineligible_at is null and exists (select 1 from audit) returning id)
             select exists (select 1 from changed) as changed from audit`
          : `with audit as (${audit}),
                 changed as (update users set campaign_ineligible_at = null, campaign_ineligible_by = null
                              where id = $1 and campaign_ineligible_at is not null and $2::uuid is not null and exists (select 1 from audit) returning id)
             select exists (select 1 from changed) as changed from audit`,
      [userId, staff.userId]);
      return { ok: true, changed: Boolean(rows[0]?.changed) };
    }
    case "budget": {
      if (!isTrackedService(input.service)) return { ok: false, error: "bad_request" };
      const service: TrackedService = input.service;
      const balance = input.balanceUsd === undefined || input.balanceUsd === null || input.balanceUsd === "" ? null : parseAmount(input.balanceUsd);
      const threshold = input.threshold === undefined || input.threshold === null || input.threshold === "" ? null : parseAmount(input.threshold);
      if ((input.balanceUsd !== undefined && input.balanceUsd !== null && input.balanceUsd !== "" && balance === null) ||
          (input.threshold !== undefined && input.threshold !== null && input.threshold !== "" && threshold === null)) {
        return { ok: false, error: "bad_request" };
      }
      const params: unknown[] = [service, balance, threshold, staff.userId];
      const audit = auditCte(params, staff.userId, "budget_set", `budget:${service}`, { reason, balanceUsd: balance, threshold });
      await sql.query(
        `with audit as (${audit})
         insert into staff_budgets (service, balance_usd, balance_at, threshold, updated_by, updated_at)
         select $1, $2, case when $2::numeric is null then null else now() end, $3, $4, now() from audit
         on conflict (service) do update set
           balance_usd = excluded.balance_usd,
           -- Every balance saved is a new reading, the same figure included
           -- (a top up back to it): spend is counted from now.
           balance_at = case when excluded.balance_usd is null then null else now() end,
           threshold = excluded.threshold, updated_by = excluded.updated_by, updated_at = now()`,
        params,
      );
      return { ok: true, changed: true };
    }
  }
}
