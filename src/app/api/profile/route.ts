import { type NextRequest } from "next/server";
import type { RewardList } from "@/lib/profile-types";
import { awardXp, setEmail } from "@/lib/server/accounts";
import { fetchPrivyEmail } from "@/lib/server/privy";
import {
  readRewardsCaller,
  resolveRewardsUser,
  rewardsResponse,
} from "@/lib/server/rewards-route";

/**
 * Profile sync: the client calls this once per session (and after identity
 * changes). Creates the account on first sight, links wallet to Privy DID,
 * enriches with the verified email, and hands out the one-time welcome and
 * email rewards. Identity precedence: a verified Privy token always wins;
 * the wallet address rides along for linking and for wallet-only users.
 */
export async function POST(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;

  let { user } = resolved;
  const rewards: RewardList = [];

  // The once-per-user index makes this idempotent: replays award 0.
  const welcome = await awardXp(user.id, "account_created", null);
  user = { ...user, xp: welcome.xp };
  if (welcome.awarded > 0) {
    rewards.push({ kind: "account_created", amount: welcome.awarded });
  }

  // Email enrichment: only Privy sessions can have one, and it's stored on
  // first sight. The award is once-per-account, so the claimed wallet row
  // getting an email later still only pays out a single time.
  if (read.caller.did && !user.email) {
    const email = await fetchPrivyEmail(read.caller.did);
    if (email) {
      await setEmail(user.id, email);
      const linked = await awardXp(user.id, "email_linked", null);
      user = { ...user, email, xp: linked.xp };
      if (linked.awarded > 0) {
        rewards.push({ kind: "email_linked", amount: linked.awarded });
      }
    }
  }

  return rewardsResponse(user, {}, rewards);
}
