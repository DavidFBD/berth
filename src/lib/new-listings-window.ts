/**
 * The New stocks email's calendar and switch (lib/server/new-listings),
 * pure so the email retry pass (lib/server/email/send) can use them
 * without importing the engine itself.
 *
 * Sending is staff approved: a staff admin lines up an announcement
 * (/staff/emails) and presses send. It is then sent over the mornings that
 * follow, within the day's share of the cap, for at most
 * NEW_LISTINGS_SEND_DAYS days from the moment it was queued, after which it
 * is done and whoever it did not reach is not written to.
 */
export const NEW_LISTINGS_SEND_DAYS = 7;

/** Whether an announcement queued at `queuedAt` is past its days at `now`. */
export function announcementExpired(queuedAt: Date | string, now: Date): boolean {
  const queued = new Date(queuedAt).getTime();
  return Number.isFinite(queued) && now.getTime() >= queued + NEW_LISTINGS_SEND_DAYS * 86_400_000;
}

/**
 * The kill switch. New stocks may be sent unless EMAIL_NEW_LISTINGS is
 * "off": unset or any other value allows it, because a person presses
 * send first. "off" stops every send of this email, retries and staff's
 * Send again included.
 */
export function newListingsSwitchOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EMAIL_NEW_LISTINGS?.trim().toLowerCase() !== "off";
}

/** One person's send of one announcement: the email_sends ref, "<announcement id>:<user id>". */
export function newListingsRef(announcementId: string, userId: string): string {
  return `${announcementId}:${userId}`;
}

/** The announcement a send's ref belongs to. */
export function announcementOfRef(ref: string): string {
  const cut = ref.indexOf(":");
  return cut < 0 ? ref : ref.slice(0, cut);
}
