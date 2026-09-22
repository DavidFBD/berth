import { TOKEN_LISTINGS } from "@/lib/listings";
import { parseFacts, type NudgeResponse } from "@/lib/nudge";
import { pickNudge } from "@/lib/server/nudge";

/**
 * The one line under the account total. The rules are in lib/nudge, the
 * choosing in lib/server/nudge.
 *
 * Facts arrive from the client and are not verified, because they only
 * decide which true-for-you line the same person is shown: claiming to hold
 * NVIDIA buys nothing but a sentence about NVIDIA. They are read strictly, so
 * the set of distinct questions is small and cached.
 *
 * Always 200, and `null` is an ordinary answer: most visits have nothing
 * worth saying, and saying nothing is the default.
 */

const KNOWN = new Set(TOKEN_LISTINGS.map((listing) => listing.symbol));

export async function GET(request: Request): Promise<Response> {
  const facts = parseFacts(new URL(request.url).searchParams, KNOWN);
  let payload: NudgeResponse;
  try {
    payload = { nudge: await pickNudge(facts) };
  } catch (error) {
    console.warn("[nudge]", error instanceof Error ? error.message : error);
    payload = { nudge: null };
  }
  return Response.json(payload);
}
