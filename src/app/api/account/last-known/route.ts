import { NextResponse, type NextRequest } from "next/server";
import { parseSnapshot, type LastKnown } from "@/lib/last-known";
import { lastKnownWriteAllowed, readLastKnown, saveLastKnown } from "@/lib/server/last-known";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export type { LastKnown } from "@/lib/last-known";
export type LastKnownResponse = { lastKnown: LastKnown | null };

/**
 * The caller's last-known home (lib/last-known, lib/server/last-known).
 * `{}` reads it; `{ save: snapshot }` keeps a live reading and answers it.
 * A body that is not a JSON object, or a snapshot that does not parse, is
 * refused, never stored; saves are capped per account per hour.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  // request.json() can yield null, a string or an array: only an object is a request.
  const body: unknown = read.caller.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "not a request" }, { status: 400 });
  }
  if ("save" in body) {
    const snapshot = parseSnapshot((body as { save: unknown }).save);
    if (!snapshot) return NextResponse.json({ error: "not a reading" }, { status: 400 });
    if (!(await lastKnownWriteAllowed(resolved.user.id))) {
      return NextResponse.json({ error: "too many saves" }, { status: 429, headers: { "retry-after": "3600" } });
    }
    return NextResponse.json({ lastKnown: await saveLastKnown(resolved.user.id, snapshot) } satisfies LastKnownResponse);
  }
  return NextResponse.json({ lastKnown: await readLastKnown(resolved.user.id) } satisfies LastKnownResponse);
}
