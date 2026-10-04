import { NextResponse, type NextRequest } from "next/server";
import { accountForDid, accountForWallet, type UserRow } from "@/lib/server/accounts";
import { readRewardsCaller } from "@/lib/server/rewards-route";
import { staffAreaOn, staffRoleFor } from "@/lib/server/staff-gate";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * POST /api/account/staff: whether the account drawer shows its quiet
 * Staff entry (docs/adr/0008-staff-area.md). Same proof of who is asking
 * as every rewards route: a Privy token, or a wallet session, since an
 * account on a staff list may be signed in with a wallet and still be
 * staff by its account id. The answer is `{ staff: true }` for an account
 * on STAFF_ADMIN_IDS or STAFF_VIEWER_IDS while the area is on, and `{}`
 * for everyone else, the same bytes whatever the reason: never the role,
 * the lists or anyone else's standing.
 *
 * It opens nothing. The area itself still needs a session minted by POST
 * /api/staff/session from an email code to the account's own email; a
 * wallet session here only learns that it must sign in that way.
 * Read only: no account is made for a caller Berth has not met.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const { did, wallet } = read.caller;
  let account: UserRow | undefined;
  try {
    account = did ? await accountForDid(did) : wallet ? await accountForWallet(wallet) : undefined;
  } catch {
    account = undefined;
  }
  const staff = Boolean(account && staffAreaOn() && staffRoleFor(account.id));
  return NextResponse.json(staff ? { staff: true } : {}, { headers: NO_STORE });
}
