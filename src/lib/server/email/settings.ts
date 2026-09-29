import type { EmailSettingsResponse } from "@/lib/email-kinds";
import { isSuppressed, primaryEmail, readPrefs } from "@/lib/server/email/store";

/** What the settings drawer shows: the verified primary email, whether mail reaches it, and the switches. */
export async function emailSettings(userId: string): Promise<EmailSettingsResponse> {
  const [address, prefs] = await Promise.all([primaryEmail(userId), readPrefs(userId)]);
  return { address, deliverable: address ? !(await isSuppressed(address)) : false, prefs };
}
