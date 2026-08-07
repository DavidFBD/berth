import { NextResponse, type NextRequest } from "next/server";
import { getSql } from "@/lib/server/db";
import { isXpKind } from "@/lib/xp";
import type { XpHistoryResponse } from "@/lib/profile-types";
import {
  readRewardsCaller,
  resolveRewardsUser,
} from "@/lib/server/rewards-route";

const LEDGER_PAGE = 30;

/**
 * The house ledger: the account's recent XP events, newest first, so every
 * award is attributable after the fact (field feedback 2026-08-07: a fresh
 * account couldn't tell where its 210 XP came from).
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;

  const sql = getSql();
  const rows = (await sql.query(
    `select kind, amount, created_at from xp_events
     where user_id = $1 order by created_at desc limit ${LEDGER_PAGE}`,
    [resolved.user.id],
  )) as { kind: string; amount: number; created_at: string }[];

  const response: XpHistoryResponse = {
    events: rows
      .filter((row) => isXpKind(row.kind))
      .map((row) => ({
        kind: row.kind,
        amount: row.amount,
        at: new Date(row.created_at).toISOString(),
      })) as XpHistoryResponse["events"],
  };
  return NextResponse.json(response);
}
