import { type NextRequest } from "next/server";
import type { RewardList } from "@/lib/profile-types";
import { normalizeInviteCode } from "@/lib/invite-code";
import {
  awardXp,
  bindReferral,
  ensureReferralCode,
  flushUnannounced,
  touchLastSeen,
  setEmail,
} from "@/lib/server/accounts";
import { fetchPrivyEmail } from "@/lib/server/privy";
import { AVAILABLE } from "@/lib/server/availability";
import { attributeInvite } from "@/lib/server/campaigns/store";
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

  // Referral binding: only a NEW account can be claimed, so an old account
  // clicking a friend's link stays unclaimed; the code is a birth
  // certificate, not a coupon. New means this account's first sync (the
  // welcome below has not been paid), whichever request created the row:
  // a wallet sign in fires several rewards calls at once, and any of them
  // may create it (bindReferral). The XP moments come later: the referred
  // account's own at its first verified pour (see xp/pour), the inviter's
  // once the friend has set up and stayed a week (lib/server/invite-xp).
  const inviteCode = normalizeInviteCode(read.caller.body.referralCode);
  if (inviteCode && !user.referred_by) {
    const referrerId = await bindReferral(user.id, inviteCode);
    if (referrerId) user = { ...user, referred_by: referrerId };
  }

  // Invite campaigns (lib/server/campaigns): an account carrying someone's
  // invite, young and opened inside a live invite campaign's dates, gets
  // its claim, which pays the one who invited it once it is set up and
  // still in use some days later. Never where Berth is not available. A
  // pocketed /c/<code> only chooses between live campaigns. A failure here
  // never fails the sync.
  if (user.referred_by && (read.caller.availability ?? AVAILABLE).available) {
    try {
      await attributeInvite(user.id, read.caller.body.campaignCode);
    } catch (error) {
      console.warn("[campaigns] attribution failed", error instanceof Error ? error.message : error);
    }
  }

  // Everyone gets a code of their own to hand out.
  user = await ensureReferralCode(user);

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

  // News that broke while this account wasn't looking — a friend's first
  // pour pays the referrer during the FRIEND's request, so the ceremony
  // waits here, on the owner's next sync, where it can actually be seen.
  rewards.push(...(await flushUnannounced(user.id)));

  // Seen today (the staff Overview's active counts), once a UTC day.
  await touchLastSeen(user.id);

  return rewardsResponse(user, {}, rewards);
}
