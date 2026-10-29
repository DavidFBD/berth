import { TOKEN_LISTINGS } from "@/lib/listings";
import { newListingsSwitchOn } from "@/lib/new-listings-window";
import type { StaffAnnouncement, StaffEmailsPreview, StaffEmailsState, StaffStock } from "@/lib/staff-emails-types";
import { listingsDailyCap, LISTINGS_TYPES, renderSample } from "@/lib/server/email/send";
import { sendsToday } from "@/lib/server/email/store";
import {
  liveStocks,
  lastQueuedAt,
  isProduction,
  observeListings,
  openAnnouncement,
  pastAnnouncements,
  progressOf,
  draftHash,
  recipientCounts,
  recipientsOf,
  type Announcement,
} from "@/lib/server/new-listings";
import type { DraftWords } from "@/lib/new-listings-draft";

/** What the staff emails page shows (lib/staff-emails-types). Reads only. */

function stocksOf(symbols: readonly string[], listings = TOKEN_LISTINGS): StaffStock[] {
  const wanted = new Set(symbols);
  return liveStocks(listings).filter((stock) => wanted.has(stock.symbol));
}

async function view(announcement: Announcement, listings = TOKEN_LISTINGS): Promise<StaffAnnouncement> {
  const ticked = new Set(announcement.chosen);
  return {
    id: announcement.id,
    status: announcement.status,
    words: announcement.words,
    stocks: stocksOf(announcement.detected, listings).map((stock) => ({ ...stock, ticked: ticked.has(stock.symbol) })),
    createdAt: announcement.createdAt,
    queuedAt: announcement.queuedAt,
    finishedAt: announcement.finishedAt,
    progress: await progressOf(announcement),
  };
}

export async function staffEmailsState(listings = TOKEN_LISTINGS): Promise<StaffEmailsState> {
  // In production the first look records the baseline (the pinned list); anywhere else this only reads.
  const production = isProduction();
  const observed = await observeListings({ listings, production });
  const open = await openAnnouncement();
  const queuedAt = await lastQueuedAt();
  let current: StaffEmailsState["current"] = null;
  if (open) {
    const recipients = await recipientsOf(open.id);
    const counts = await recipientCounts(open.id);
    current = { ...(await view(open, listings)), recipients, sendCount: counts.sendCount, recipientTotal: counts.total, hash: (await draftHash(open.id)) ?? "" };
  }
  return {
    detected: observed.kind === "new" ? stocksOf(observed.detected, listings) : [],
    switchOn: newListingsSwitchOn(),
    production,
    baselineRecorded: observed.kind !== "baseline",
    today: { cap: listingsDailyCap(), used: await sendsToday(LISTINGS_TYPES) },
    lastQueuedAt: queuedAt,
    recentlyQueued: queuedAt !== null && Date.now() - new Date(queuedAt).getTime() < 7 * 86_400_000,
    current,
    history: await Promise.all((await pastAnnouncements()).map((row) => view(row, listings))),
  };
}

/** The draft as the real email renders it (the sample renderer, with a sample unsubscribe link), for the page's iframe. */
export async function previewOf(words: DraftWords, chosen: readonly string[], listings = TOKEN_LISTINGS): Promise<StaffEmailsPreview> {
  const names = stocksOf(chosen, listings).map((stock) => stock.name);
  const rendered = await renderSample({ type: "new_listings", names: names.length > 0 ? names : ["(no stock ticked)"], words });
  return { subject: rendered.subject, html: rendered.html };
}
