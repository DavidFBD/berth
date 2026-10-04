import { NextResponse, type NextRequest } from "next/server";
import { parseSnapshot, type LastKnown } from "@/lib/last-known";
import { readLastKnown, saveLastKnown } from "@/lib/server/last-known";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export type { LastKnown } from "@/lib/last-known";
export type LastKnownResponse = { lastKnown: LastKnown | null };

/**
 * The caller's last-known home (lib/last-known, lib/server/last-known).
 * `{}` reads it; `{ save: snapshot }` keeps a live reading and answers it.
 * A snapshot that does not parse is refused, never stored.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const body = read.caller.body;
  if ("save" in body) {
    const snapshot = parseSnapshot(body.save);
    if (!snapshot) return NextResponse.json({ error: "not a reading" }, { status: 400 });
    return NextResponse.json({ lastKnown: await saveLastKnown(resolved.user.id, snapshot) } satisfies LastKnownResponse);
  }
  return NextResponse.json({ lastKnown: await readLastKnown(resolved.user.id) } satisfies LastKnownResponse);
}
