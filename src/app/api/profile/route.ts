import { NextResponse, type NextRequest } from "next/server";
import { verifyPrivyAuth, fetchPrivyEmail } from "@/lib/server/privy";
import {
  awardXp,
  getOrCreateUser,
  normalizeWallet,
  setEmail,
  toProfile,
} from "@/lib/server/accounts";

/**
 * Profile sync: the client calls this once per session (and after identity
 * changes). Creates the account on first sight, links wallet to Privy DID,
 * enriches with the verified email, and hands out the one-time welcome and
 * email rewards. Identity precedence: a verified Privy token always wins;
 * the wallet address rides along for linking and for wallet-only users.
 */
export async function POST(request: NextRequest) {
  let did: string | null;
  try {
    did = await verifyPrivyAuth(request.headers.get("authorization"));
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    walletAddress?: unknown;
  };
  const wallet = normalizeWallet(body.walletAddress);

  const result = await getOrCreateUser({ did, wallet });
  if (!result) {
    return NextResponse.json({ error: "no identity" }, { status: 400 });
  }
  let { user } = result;

  const rewards: { kind: string; amount: number }[] = [];
  if (result.created) {
    const { awarded } = await awardXp(user.id, "account_created", null);
    if (awarded > 0) rewards.push({ kind: "account_created", amount: awarded });
  }

  // Email enrichment: only Privy sessions can have one, and it's stored on
  // first sight. The award is once-per-account, so the claimed wallet row
  // getting an email later still only pays out a single time.
  if (did && !user.email) {
    const email = await fetchPrivyEmail(did);
    if (email) {
      await setEmail(user.id, email);
      user = { ...user, email };
      const { awarded } = await awardXp(user.id, "email_linked", null);
      if (awarded > 0) rewards.push({ kind: "email_linked", amount: awarded });
    }
  }

  // Re-read the total: awards above moved it.
  const fresh = await getOrCreateUser({ did, wallet });
  return NextResponse.json({
    ...toProfile(fresh?.user ?? user),
    rewards,
  });
}
