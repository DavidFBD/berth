/**
 * The client half of a campaign link, the invite pocket's twin
 * (lib/referral): the /c/<code> landing puts the code here before sign in,
 * the profile sync that creates the account carries it, and the sync spends
 * it either way. The server attributes it only to a new account, so a code
 * left in the pocket of an older account is ignored, not honoured.
 */

import { normalizeCampaignCode } from "@/lib/campaigns";

const STORAGE_KEY = "berth.campaign";

export function pocketCampaignCode(raw: string): void {
  if (typeof window === "undefined") return;
  const code = normalizeCampaignCode(raw);
  if (!code) return;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage denied (private mode): the campaign just doesn't stick.
  }
}

export function pendingCampaignCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeCampaignCode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearPendingCampaign(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
