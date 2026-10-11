import { NextResponse, type NextRequest } from "next/server";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";
import { flushUnannounced, toProfile } from "@/lib/server/accounts";
import { submitFeedback } from "@/lib/server/feedback";
import { cleanBody, readFeedbackOrder, sanitizeContext } from "@/lib/feedback";
import type { ProfileResponse, RewardList } from "@/lib/profile-types";

export type FeedbackPostResponse = ProfileResponse & { feedback: { id: string; awarded: number } };

export const dynamic = "force-dynamic";

/**
 * POST /api/feedback { body, mayReply?, context?, order? }: one message
 * from the feedback sheet (lib/server/feedback). Signed in only, by the
 * same proof as every rewards route (a Privy token or a wallet session):
 * 401 without one. 400 for an empty or too long message, 429 past five an
 * hour or twenty a day. The context is cleaned here (lib/feedback
 * sanitizeContext) whatever the browser sent. The answer is the profile
 * envelope, so the sheet can show the first message's XP and the toast
 * can announce it, plus `feedback: { id, awarded }`.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const raw: unknown = read.caller.body;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json({ error: "not a request" }, { status: 400 });
  }
  const input = raw as Record<string, unknown>;
  const body = cleanBody(input.body);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });

  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;
  const user = resolved.user;

  const result = await submitFeedback({
    userId: user.id,
    body: body.body,
    context: sanitizeContext(input.context),
    order: readFeedbackOrder(input.order),
    mayReply: input.mayReply === true,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "too many" }, { status: 429, headers: { "retry-after": "3600" } });
  }
  const rewards: RewardList = result.awarded > 0 ? [{ kind: "feedback_first", amount: result.awarded }] : [];
  rewards.push(...(await flushUnannounced(user.id).catch(() => [])));
  const profile = toProfile(result.xp === null ? user : { ...user, xp: result.xp });
  return NextResponse.json({ ...profile, rewards, feedback: { id: result.id, awarded: result.awarded } } satisfies FeedbackPostResponse);
}
