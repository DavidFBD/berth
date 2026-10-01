import { cookies } from "next/headers";
import { notFound, unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { readLiveSession } from "@/lib/server/staff-sessions";
import { getSql } from "@/lib/server/db";
import { scrubPersonal } from "@/lib/staff/mask";
import {
  cookieFromHeader,
  readStaffSessionToken,
  staffCookieName,
  staffFresh,
  staffSessionKey,
  staffRoleFor,
} from "@/lib/server/staff-session";

/**
 * The staff area's gate for pages, server actions and its own routes
 * (docs/adr/0008-staff-area.md): the one session system of the whole
 * staff area, the campaigns routes included (lib/server/staff-auth reads
 * staffFromCookie). A signed session cookie (lib/server/staff-session),
 * minted by POST /api/staff/session from a Privy email sign in, so a page
 * can know who is asking without the Authorization header a navigation
 * never carries. Roles from the environment on every request:
 * STAFF_ADMIN_IDS (admin) and STAFF_VIEWER_IDS (read only).
 *
 * To anyone not on a list the area does not exist: pages call notFound(),
 * routes answer the same 404 as an address Berth has no page for, for
 * every method. A viewer at an admin's door: 404 on a page, 403 on a
 * route. A reveal or a write also needs a fresh proof: an email code
 * entered in the last 15 minutes (STAFF_FRESH_MS), else 401 `stale` and
 * the page asks for a new sign in. Wallet sessions never open it.
 *
 * There is no impersonation, no "sign in as", nothing that signs or moves
 * money, and no hand edit of a balance or of XP.
 *
 * Usage:
 *   const staff = await staffGate("page");              // a server component
 *   const staff = await staffGate("action", "admin");   // a server action
 *   export const POST = staffRoute(handler, { role: "admin", fresh: true });
 *   await recordStaff(staff, "profile_hide", `user:${id}`, { reason });
 */

export type StaffRole = "viewer" | "admin";

export type StaffContext = {
  userId: string;
  /** The staff_sessions row this request came in on. */
  sessionId?: string;
  role: StaffRole;
  /** When the email code was last entered, epoch ms, or null. */
  authAt: number | null;
  /** Whether that proof is recent enough for a reveal or a write. */
  fresh: boolean;
};

/** Where the check runs: a page, a server action, or a route handler's request. */
export type StaffSurface = "page" | "action" | Request;

/** The admins' account ids, lowercase: the one allowlist rule (staff-session staffRoleFor, staff-auth staffAdminIds). */
export function staffAdminIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.STAFF_ADMIN_IDS ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter((id) => /^[0-9a-f-]{36}$/.test(id));
}

export { staffRoleFor };

/** Whether the staff area is switched on at all: a session secret and at least one admin. */
export function staffAreaOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return staffSessionKey(env) !== null && staffAdminIds(env).length > 0;
}

export class StaffAccessError extends Error {
  constructor(
    readonly status: 401 | 403 | 404,
    readonly code: "not_found" | "admin_only" | "stale",
  ) {
    super(code);
    this.name = "StaffAccessError";
  }
}

/** The answer a route gives for a StaffAccessError, uncached. Not found reads like any other 404. */
export function staffErrorResponse(error: StaffAccessError): NextResponse {
  const body = error.code === "not_found" ? { error: "not found" } : { error: error.code };
  return NextResponse.json(body, { status: error.status, headers: STAFF_NO_STORE });
}

export const STAFF_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

async function cookieValue(surface: StaffSurface): Promise<string | null> {
  const name = staffCookieName();
  if (typeof surface === "string") return (await cookies()).get(name)?.value ?? null;
  return cookieFromHeader(surface.headers.get("cookie"), name);
}

/**
 * The staff member a cookie value stands for, or null: a validly signed
 * cookie naming a live session (not expired, not revoked) of a live
 * account that is on an allowlist now. The proxy asks this too.
 */
export async function staffFromCookie(cookie: string | null, now = Date.now()): Promise<StaffContext | null> {
  if (!staffAreaOn()) return null;
  const claims = await readStaffSessionToken(cookie, staffSessionKey(), now);
  if (!claims) return null;
  const session = await readLiveSession(claims.sessionId, now);
  if (!session) return null;
  const role = staffRoleFor(session.userId);
  if (!role) return null;
  return { userId: session.userId, sessionId: session.id, role, authAt: session.authAt, fresh: staffFresh(session.authAt, now) };
}

/** The staff member behind this request, or null (staffFromCookie). */
export async function readStaff(surface: StaffSurface, now = Date.now()): Promise<StaffContext | null> {
  return staffFromCookie(await cookieValue(surface), now);
}

function deny(surface: StaffSurface, error: StaffAccessError): never {
  if (typeof surface === "string" && error.code !== "stale") notFound();
  throw error;
}

/**
 * The gate. Anyone not on an allowlist: notFound() on a page or an action,
 * StaffAccessError 404 on a route. A viewer at an admin's door: 404 on a
 * page or action, 403 on a route. With `{ fresh: true }`, a proof older
 * than 15 minutes throws StaffAccessError 401 `stale` on every surface.
 */
export async function staffGate(
  surface: StaffSurface,
  role: StaffRole = "viewer",
  { fresh = false }: { fresh?: boolean } = {},
): Promise<StaffContext> {
  let staff: StaffContext | null;
  try {
    staff = await readStaff(surface);
  } catch (error) {
    // A database that cannot be read is not a reason to answer differently.
    console.warn("[staff] gate read failed:", error instanceof Error ? error.name : "error");
    staff = null;
  }
  if (!staff) deny(surface, new StaffAccessError(404, "not_found"));
  if (role === "admin" && staff.role !== "admin") deny(surface, new StaffAccessError(403, "admin_only"));
  if (fresh && !staff.fresh) throw new StaffAccessError(401, "stale");
  return staff;
}

/** staffGate for a reveal or a write: an admin, with a proof from the last 15 minutes. */
export function requireFreshAdmin(surface: StaffSurface): Promise<StaffContext> {
  return staffGate(surface, "admin", { fresh: true });
}

/**
 * One row in staff_audit: who (`staff`), what (`action`, a short snake
 * case verb), on what (`target`, such as `user:<id>`, never an email or an
 * address), and `detail` (the reason, the outcome), scrubbed of any email
 * or wallet before it is written. It throws when the row cannot be
 * written: a reveal or a write that cannot be recorded does not happen.
 */
export async function recordStaff(
  staff: StaffContext | { userId: string } | string,
  action: string,
  target: string | null = null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const staffUserId = typeof staff === "string" ? staff : staff.userId;
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(action)) throw new Error("staff audit: bad action name");
  await getSql().query(`insert into staff_audit (staff_user_id, action, target, detail) values ($1, $2, $3, $4::jsonb)`, [
    staffUserId,
    action,
    target === null ? null : scrubPersonal(target).slice(0, 200),
    JSON.stringify(scrubPersonal(detail)),
  ]);
}

/**
 * The same row as an SQL fragment, for a write that records itself in its
 * own statement: `with audit as (${auditCte(...)}) update ...`, so the
 * action and its audit row commit together or not at all. Its parameters
 * are appended to `params`.
 */
export function auditCte(params: unknown[], staffUserId: string, action: string, target: string | null, detail: Record<string, unknown>): string {
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(action)) throw new Error("staff audit: bad action name");
  params.push(staffUserId, action, target === null ? null : scrubPersonal(target).slice(0, 200), JSON.stringify(scrubPersonal(detail)));
  const n = params.length;
  return `insert into staff_audit (staff_user_id, action, target, detail) values ($${n - 3}::uuid, $${n - 2}, $${n - 1}, $${n}::jsonb) returning id`;
}

/**
 * A route handler under /api/staff: the gate, a same origin check on
 * anything that is not a read, the audit-safe error mapping, and no
 * caching. The handler gets the staff member and the request.
 */
export function staffRoute<R extends Request>(
  handler: (staff: StaffContext, request: R) => Promise<Response>,
  options: { role?: StaffRole; fresh?: boolean } = {},
): (request: R) => Promise<Response> {
  return async (request) => {
    try {
      const staff = await staffGate(request, options.role ?? "viewer", { fresh: options.fresh ?? false });
      if (request.method !== "GET" && request.method !== "HEAD" && !sameOrigin(request)) {
        notFound();
      }
      const response = await handler(staff, request);
      response.headers.set("Cache-Control", STAFF_NO_STORE["Cache-Control"]);
      return response;
    } catch (error) {
      // Not staff: the very 404 Next gives an address it has no route for.
      if (error instanceof StaffAccessError && error.code === "not_found") notFound();
      if (error instanceof StaffAccessError) return staffErrorResponse(error);
      // notFound() from the handler itself (or from the origin check) goes on to Next.
      unstable_rethrow(error);
      console.warn("[staff] route failed:", error instanceof Error ? error.name : "error");
      return NextResponse.json({ error: "failed" }, { status: 500, headers: STAFF_NO_STORE });
    }
  };
}

/** A write must come from a staff page on this same origin (the cookie is SameSite=Strict too). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Every other method of a staff route: the same 404 as an unknown address,
 * never a 405 that would say the route exists. Spread into a route file:
 * `export const { GET, PUT, PATCH, DELETE, HEAD, OPTIONS } = STAFF_OTHER_METHODS;` for
 * the methods it does not serve.
 */
const otherMethod = async (): Promise<Response> => notFound();
export const STAFF_OTHER_METHODS = {
  GET: otherMethod,
  PUT: otherMethod,
  PATCH: otherMethod,
  DELETE: otherMethod,
  POST: otherMethod,
  HEAD: otherMethod,
  OPTIONS: otherMethod,
} as const;
