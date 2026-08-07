import { NextResponse, type NextRequest } from "next/server";
import { hubTxSucceeded } from "@/lib/server/hub-tx";
import {
  awardAndRespond,
  readRewardsCaller,
  resolveRewardsUser,
} from "@/lib/server/rewards-route";

/** Reward a filled pour. Body: direction ('in' | 'out') + the intent's hub tx hash. */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;

  const kind = read.caller.body.direction === "out" ? "pour_out" : "pour_in";
  const txHash =
    typeof read.caller.body.intentTxHash === "string"
      ? read.caller.body.intentTxHash.toLowerCase()
      : "";
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "bad tx hash" }, { status: 400 });
  }

  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;

  if (!(await hubTxSucceeded(txHash))) {
    return NextResponse.json({ error: "tx not confirmed" }, { status: 422 });
  }
  return awardAndRespond(resolved.user, kind, txHash);
}
