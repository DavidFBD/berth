import { NextResponse, type NextRequest } from "next/server";
import { buildRedirect, readConsent } from "@/lib/server/oauth/authorize";
import { getClient } from "@/lib/server/oauth/clients";
import { publicOrigin } from "@/lib/server/oauth/config";
import { issueCode } from "@/lib/server/oauth/tokens";
import { redirectUriMatches } from "@/lib/server/oauth/validation";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export const dynamic = "force-dynamic";

/**
 * The person's answer on the consent screen (app/oauth/authorize).
 *
 *   POST { request, decision: "approve" | "decline" }
 *
 * `request` is the signed consent request the page was rendered with
 * (lib/server/oauth/authorize); nothing else in the body is believed. An
 * approval needs the same proof of identity as every account route (a
 * Privy token or a wallet session, readRewardsCaller) and mints a single
 * use code for that account. A decline needs no identity. Either way the
 * answer is `{ redirect }`, the client's redirect URI with the response on
 * it, which the page navigates to; the page never builds a redirect itself.
 * Identity rides in headers, never cookies, so a cross site form cannot
 * approve on anyone's behalf.
 */
export async function POST(request: NextRequest) {
  const issuer = publicOrigin(request.headers, request.url);
  // Read the body once: readRewardsCaller consumes it, so a decline reads a clone.
  const peek = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const consent = await readConsent(peek.request, issuer);
  if (!consent) return NextResponse.json({ error: "consent request expired" }, { status: 400 });

  // The client may have changed its registration since the page rendered.
  const client = await getClient(consent.clientId);
  if (!client || !redirectUriMatches(consent.redirectUri, client.redirectUris)) {
    return NextResponse.json({ error: "client no longer valid" }, { status: 400 });
  }

  if (peek.decision === "decline") {
    return NextResponse.json({
      redirect: buildRedirect(
        consent.redirectUri,
        { error: "access_denied", error_description: "The person declined.", state: consent.state },
        issuer,
      ),
    });
  }
  if (peek.decision !== "approve") return NextResponse.json({ error: "no decision" }, { status: 400 });

  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;

  const code = await issueCode(resolved.user.id, consent);
  return NextResponse.json({
    redirect: buildRedirect(consent.redirectUri, { code, state: consent.state }, issuer),
  });
}
