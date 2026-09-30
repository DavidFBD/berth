import type { NextRequest } from "next/server";
import { refuseSanctioned } from "@/lib/server/availability";
import { runMerge } from "@/lib/server/account-merge-route";

export const dynamic = "force-dynamic";

/** Two accounts become one, from an offer made in the last ten minutes (lib/server/account-merge-route). */
export async function POST(request: NextRequest) {
  // No account is served from a comprehensively sanctioned place (lib/server/availability).
  return refuseSanctioned(request.headers, request.url) ?? runMerge(request);
}
