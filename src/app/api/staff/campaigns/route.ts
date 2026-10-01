import { NextResponse, type NextRequest } from "next/server";
import { nextNotFound } from "@/lib/server/not-found-response";
import { requireFreshStaff, requireStaff, staffAudit } from "@/lib/server/staff-auth";
import { sameOrigin } from "@/lib/server/staff-gate";
import { revealClaim, staffQueue, type StaffQueue } from "@/lib/server/campaigns/queue";
import {
  addPayoutSource,
  approveClaim,
  createCampaign,
  markClaimPaid,
  rejectClaim,
  removePayoutSource,
  setCampaignActive,
  type ActionResult,
} from "@/lib/server/campaigns/actions";

export const dynamic = "force-dynamic";

/** What the staff page reads: the queue, and after an action, how it went. */
export type StaffCampaignsResponse = StaffQueue & { result?: ActionResult };

const id = (value: unknown): string | null =>
  typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value.toLowerCase() : null;

/** The acts that make a promise or record money: a sign in from the last fifteen minutes, by email (requireFreshStaff). */
const FRESH_ACTIONS = new Set(["activate", "approve", "reject", "paid", "add_source", "remove_source"]);

/**
 * The staff campaigns endpoint (app/staff/campaigns). To anyone not on
 * STAFF_ADMIN_IDS, and for every method but POST, this is Next's own 404,
 * as for a path that does not exist. `{ action: "queue" }` reads (masked);
 * `reveal` shows one claim's email or wallets, audited; every other action
 * writes, audited (lib/server/campaigns/actions), and answers the fresh
 * queue with its result. A failure is audited and answered as a refusal,
 * never a 500. Nothing here sends money.
 */
export async function POST(request: NextRequest) {
  // Like every staff write (staffRoute): from a staff page on this very origin, or nothing.
  // SameSite=Strict already stops other sites; this also stops a sibling subdomain.
  if (!sameOrigin(request)) return nextNotFound(request);
  const body = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const gate = FRESH_ACTIONS.has(action) ? await requireFreshStaff(request, "admin") : await requireStaff(request, "admin");
  if (!gate.ok) {
    if ("stale" in gate) return NextResponse.json({ error: "stale" }, { status: 401, headers: { "cache-control": "no-store" } });
    return nextNotFound(request);
  }
  const staff = gate.staff.userId;
  let result: ActionResult | undefined;
  try {
    switch (action) {
      case "queue":
        await staffAudit({ staffUserId: staff, action: "campaign.queue_view" });
        break;
      case "reveal": {
        const claimId = id(body.claimId);
        const field = body.field === "email" || body.field === "wallets" ? body.field : null;
        if (!claimId || !field) {
          result = { ok: false, refusal: "bad_input" };
          break;
        }
        const values = await revealClaim(claimId, field);
        await staffAudit({ staffUserId: staff, action: "claim.reveal", target: claimId, detail: { field, outcome: values ? "done" : "not_found" } });
        result = values ? { ok: true, detail: { claimId, field, values } } : { ok: false, refusal: "not_found" };
        break;
      }
      case "create":
        result = await createCampaign(staff, (body.campaign ?? {}) as Parameters<typeof createCampaign>[1]);
        break;
      case "activate":
      case "pause": {
        const campaignId = id(body.campaignId);
        result = campaignId
          ? await setCampaignActive(staff, campaignId, action === "activate", body.counselReviewed)
          : { ok: false, refusal: "bad_input" };
        break;
      }
      case "add_source": {
        const campaignId = id(body.campaignId);
        result = campaignId ? await addPayoutSource(staff, campaignId, body.address, body.reason) : { ok: false, refusal: "bad_input" };
        break;
      }
      case "remove_source": {
        const sourceId = id(body.sourceId);
        result = sourceId ? await removePayoutSource(staff, sourceId, body.reason) : { ok: false, refusal: "bad_input" };
        break;
      }
      case "approve":
      case "reject":
      case "paid": {
        const claimId = id(body.claimId);
        if (!claimId) {
          result = { ok: false, refusal: "bad_input" };
          break;
        }
        result =
          action === "approve"
            ? await approveClaim(staff, claimId)
            : action === "reject"
              ? await rejectClaim(staff, claimId, body.reason, body.note)
              : await markClaimPaid(staff, claimId, body.txHash);
        break;
      }
      default:
        result = { ok: false, refusal: "bad_input" };
    }
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : "error";
    console.warn("[staff/campaigns]", action, message);
    await staffAudit({ staffUserId: staff, action: `campaign.${action || "unknown"}.error`, target: id(body.claimId) ?? id(body.campaignId), detail: { outcome: "error", message } }).catch(
      () => undefined,
    );
    result = { ok: false, refusal: "error" };
  }
  let queue: StaffQueue = { campaigns: [], claims: [] };
  try {
    queue = await staffQueue();
  } catch (error) {
    console.warn("[staff/campaigns] queue read failed", error instanceof Error ? error.message : error);
    result = result ?? { ok: false, refusal: "error" };
  }
  return NextResponse.json({ ...queue, result } satisfies StaffCampaignsResponse, {
    headers: { "cache-control": "no-store" },
  });
}

/** Every other method is a path that is not there. */
function missing(request: Request): Promise<NextResponse> {
  return nextNotFound(request);
}
export const GET = missing;
export const PUT = missing;
export const PATCH = missing;
export const DELETE = missing;
export const OPTIONS = missing;
export const HEAD = missing;
