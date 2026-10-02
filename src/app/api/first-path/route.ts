import { NextResponse, type NextRequest } from "next/server";
import { firstPathWriteAllowed, parseFirstPathWrite, readFirstPath, writeFirstPath } from "@/lib/server/first-path";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export type { FirstPathResponse } from "@/lib/first-path";

/**
 * The guided first path for the caller's account (lib/first-path). A plain
 * POST reads it; `{ skip }`, `{ unskip }`, `{ funded: true }`,
 * `{ invited: true }` or `{ finish: true }` writes one thing first. Every
 * write is idempotent, and every answer is the whole new state.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const write = parseFirstPathWrite(read.caller.body);
  if (write) {
    if (!(await firstPathWriteAllowed(resolved.user.id))) {
      return NextResponse.json({ error: "slow_down" }, { status: 429 });
    }
    await writeFirstPath(resolved.user.id, write);
  }
  const state = await readFirstPath(resolved.user.id);
  if (!state) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(state);
}
