import { after } from "next/server";
import { getSql } from "@/lib/server/db";
import { normalizeCampaignCode } from "@/lib/campaigns";

/**
 * How often a campaign's link was opened, for the staff campaign card
 * (campaign_link_opens, db/schema.sql). One counter per campaign per UTC
 * day, bumped when /c/<code> renders its landing. Nothing about the visitor
 * is written: no IP, no cookie, no account, no user agent. The user agent
 * and the prefetch headers are only read, to leave out link previewers
 * (X, Slack, WhatsApp and the like fetch a link to draw its card) and
 * router prefetches, which are not people opening the link.
 *
 * Counted server side in the page, not by a beacon: /c/<code> is already
 * rendered on every request (force-dynamic, and it reads the request
 * headers for the availability check), so there is no static or CDN copy
 * to keep, and no script or extra route is needed. The write runs after
 * the response (next/server `after`), so it never slows or fails the page.
 */

/** User agents that fetch a link to preview it, not a person opening it. */
const PREVIEWER = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|vkshare|pinterest|bitly|curl|wget|python-requests|headless/i;

/** Whether a request to /c/<code> is a person opening the link. Reads headers, keeps nothing. Pure. */
export function countsAsOpen(headers: Pick<Headers, "get">): boolean {
  const purpose = `${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch") || headers.get("next-router-prefetch") !== null) return false;
  const agent = headers.get("user-agent");
  if (!agent) return false;
  return !PREVIEWER.test(agent);
}

/** Adds one open to the campaign with this code, today (UTC). An unknown code writes nothing. */
export async function recordLinkOpen(raw: string, now: Date = new Date()): Promise<void> {
  const code = normalizeCampaignCode(raw);
  if (!code) return;
  await getSql().query(
    `insert into campaign_link_opens (campaign_id, day, opens)
     select id, ($2::timestamptz at time zone 'UTC')::date, 1 from campaigns where code = $1
     on conflict (campaign_id, day) do update set opens = campaign_link_opens.opens + 1`,
    [code, now.toISOString()],
  );
}

/** Every campaign's opens, all days summed, by campaign id. */
export async function linkOpensByCampaign(): Promise<Map<string, number>> {
  const rows = (await getSql().query(
    `select campaign_id, sum(opens)::int as opens from campaign_link_opens group by campaign_id`,
  )) as { campaign_id: string; opens: number }[];
  return new Map(rows.map((row) => [String(row.campaign_id), Number(row.opens)]));
}

let warned = false;

/** Counts this request as an open of /c/<code> when it is one, after the response. Never throws. */
export function countLinkOpen(code: string, headers: Pick<Headers, "get">): void {
  if (!countsAsOpen(headers)) return;
  const write = () =>
    recordLinkOpen(code).catch((error) => {
      if (warned) return;
      warned = true;
      console.warn("[campaigns] link open not counted", error instanceof Error ? error.message : error);
    });
  try {
    after(write);
  } catch {
    void write();
  }
}
