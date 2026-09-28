import { NextResponse, type NextRequest } from "next/server";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";
import { chatGate, statusOf, type ChatStatusResponse } from "@/lib/server/chat/gate";

export const dynamic = "force-dynamic";

export type { ChatStatusResponse } from "@/lib/server/chat/gate";

/**
 * What the chat sheet shows before anything is sent: open (with the
 * messages left today), locked below the chat rung (and how far off it is),
 * or closed for a reason the sheet says in words. POST, like every account
 * read. The chat route checks all of it again for itself.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const gate = await chatGate(resolved.user);
  const body: ChatStatusResponse = statusOf(gate, Number(resolved.user.xp));
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
