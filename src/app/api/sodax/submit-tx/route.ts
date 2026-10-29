import type { NextRequest } from "next/server";
import { detectFamily, normalizeAddress } from "@/lib/identity/caip";
import { linkedWallets } from "@/lib/server/identities";
import { takeRatePlace } from "@/lib/server/oauth/rate-limit";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";
import { MAX_SUBMIT_BODY_BYTES, forwardSubmit, parseSubmitBody } from "@/lib/server/sodax-submit";
import { sameOrigin } from "@/lib/server/staff-gate";

/**
 * Tells SODAX about an order the browser has just broadcast, with the house's
 * key, so the volume is attributed (see lib/sodax-shadow). A sibling of the
 * generic proxy at /api/sodax/[...path], which it shadows for this one path:
 * the proxy forwards any body to its three routes, this lends the key only to
 * a signed in person, from this site, describing an order from one of their
 * own wallets, in a strict shape.
 *
 * Fire and forget on the caller's side: always a small JSON answer, never the
 * upstream's text. Without `SODAX_API_KEY` it still forwards, unkeyed, like
 * the proxy.
 */

export const dynamic = "force-dynamic";

/** Per person per hour (the limiter's window): more orders than a real person places. */
const PER_HOUR = 60;

const refuse = (status: number) => Response.json({ ok: false }, { status });

export async function POST(request: NextRequest) {
  // From a page on this very origin, as JSON: a cross site form or a
  // text/plain post is turned away before anything is read.
  if (!sameOrigin(request)) return refuse(403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return refuse(415);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_SUBMIT_BODY_BYTES) return refuse(413);

  // The signed in person: Privy token, or the wallet session (lib/server/rewards-route).
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const { user } = resolved;

  const allowed = await takeRatePlace("sodax-submit", user.id, PER_HOUR).catch(() => true);
  if (!allowed) return refuse(429);

  const body = parseSubmitBody(read.caller.body);
  if (!body) return refuse(400);

  // The source wallet must be one of this person's own.
  const family = detectFamily(body.walletAddress);
  const claimed = family ? normalizeAddress(family, body.walletAddress) : null;
  if (!family || !claimed) return refuse(403);
  const wallets = await linkedWallets(user.id, user.wallet_address).catch(() => []);
  const owned = wallets.some((wallet) => wallet.family === family && normalizeAddress(family, wallet.address) === claimed);
  if (!owned) return refuse(403);

  const outcome = await forwardSubmit(body, process.env.SODAX_API_KEY);
  return Response.json(outcome.body, { status: outcome.status });
}
