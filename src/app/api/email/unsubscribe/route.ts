import { NextResponse, type NextRequest } from "next/server";
import { setPref } from "@/lib/server/email/store";
import { readUnsubscribeToken } from "@/lib/server/email/token";

export const dynamic = "force-dynamic";

/**
 * The List-Unsubscribe target (RFC 8058).
 *
 * POST from a mail client (body `List-Unsubscribe=One-Click`): that kind
 * of email is switched off, and the answer is an empty 200. POST from the
 * unsubscribe page's own form (`action=off` or `action=on`): the same
 * switch, then back to the page to say what happened. GET never changes
 * anything, since mail scanners open links: it only shows the page, where
 * a button confirms. A token past its 180 days still turns a kind off
 * (never on), and the switch is saved on the account the email's account
 * was merged into (setPref).
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t") ?? "";
  return pageRedirect(request, token);
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t") ?? "";
  const form = await request.formData().catch(() => null);
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const action = form?.get("action");
  const claims = await readUnsubscribeToken(token, { allowExpired: true });
  if (!claims) {
    return oneClick ? new NextResponse(null, { status: 400 }) : pageRedirect(request, token);
  }
  // A kind Berth no longer sends: nothing to switch, and nothing went wrong.
  if ("retired" in claims) {
    return oneClick ? new NextResponse(null, { status: 200 }) : pageRedirect(request, token);
  }
  const enabled = !oneClick && action === "on";
  // An old link may only turn a kind off. New stocks is marketing, so turning it on is the person's own act
  // in Settings, never a button on a link anyone holding a forwarded email could press.
  if (enabled && (claims.expired || claims.kind === "listings")) return pageRedirect(request, token);
  try {
    await setPref(claims.userId, claims.kind, enabled);
  } catch (error) {
    console.warn("[email] unsubscribe not saved:", error instanceof Error ? error.name : "error");
    return oneClick ? new NextResponse(null, { status: 500 }) : pageRedirect(request, token, "failed");
  }
  if (oneClick) return new NextResponse(null, { status: 200 });
  return pageRedirect(request, token, enabled ? "on" : "off");
}

function pageRedirect(request: NextRequest, token: string, state?: "on" | "off" | "failed"): NextResponse {
  const url = new URL("/email/u", request.nextUrl.origin);
  if (token) url.searchParams.set("t", token);
  if (state) url.searchParams.set("s", state);
  // 303: the browser follows with a GET, so a reload never posts again.
  return NextResponse.redirect(url, { status: 303, headers: { "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" } });
}
