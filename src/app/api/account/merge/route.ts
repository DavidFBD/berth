import type { NextRequest } from "next/server";
import { runMerge } from "@/lib/server/account-merge-route";

export const dynamic = "force-dynamic";

/** Two accounts become one, from an offer made in the last ten minutes (lib/server/account-merge-route). */
export async function POST(request: NextRequest) {
  return runMerge(request);
}
