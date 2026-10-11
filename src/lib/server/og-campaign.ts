import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { COPY } from "@/lib/copy";
import { campaignUsd, landingPreview, normalizeCampaignCode, type CampaignLanding } from "@/lib/campaigns";
import { ogCampaignImage, ogImage } from "@/lib/og/card";
import { OG_VERSION, ogImageRef } from "@/lib/og/metadata";
import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/size";
import { campaignLanding } from "@/lib/server/campaigns/store";
import { canonicalRedirect } from "@/lib/server/og-people";
import { overrideAllowed } from "@/lib/server/availability";

/**
 * A campaign link's preview card (/c/<code>, app/og/c/[code]). A live
 * campaign gets its own card with its real amount (lib/og/card
 * ogCampaignElement); a paused, ended, full or unknown one gets the home
 * card, with no promise in it.
 *
 * The picture's address carries `?v=`, a hash of the cards' version, the
 * code and the amount, and the page names it only while the campaign is
 * live: a new amount is a new address, and a campaign that stops being
 * live stops being pointed at, so the picture is cached for an hour at the
 * edge and changes only when the amount or the state does.
 */

/** A live card at the edge: an hour fresh, a day stale while it is drawn again. Never in the browser. */
export const LIVE_CARD_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": OG_CONTENT_TYPE,
  "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
  "X-Content-Type-Options": "nosniff",
});

/** The fallback, short: a campaign that goes live again gets its own card within minutes. */
export const FALLBACK_CARD_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Type": OG_CONTENT_TYPE,
  "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=300",
  "X-Content-Type-Options": "nosniff",
});

/** The amount a card may show: a live campaign's, else none. Pure. */
export function cardAmount(landing: CampaignLanding): number | null {
  return landing.state === "live" && landing.amountUsd > 0 ? landing.amountUsd : null;
}

/** The versioned address of a live campaign's card. Pure. */
export function campaignImageUrl(code: string, amountUsd: number): string {
  const v = createHash("sha256").update(JSON.stringify([OG_VERSION, "campaign", code, amountUsd])).digest("hex").slice(0, 12);
  return `/og/c/${encodeURIComponent(code)}?v=${v}`;
}

/**
 * The page's link preview words and picture. Live: the campaign's own
 * card and summary_large_image. Anything else: the home card and the
 * home's words, so nothing is promised.
 */
export function campaignCardMetadata(landing: CampaignLanding): Pick<Metadata, "openGraph" | "twitter"> {
  const amount = cardAmount(landing);
  const words = COPY.og.campaign;
  if (amount === null || landing.state !== "live") {
    const home = ogImageRef("/", COPY.og.home.alt);
    const title = COPY.og.home.title;
    const description = COPY.og.home.line;
    return {
      openGraph: { title, description, siteName: "Berth", type: "website", images: [home.og] },
      twitter: { card: "summary_large_image", title, description, images: [home.twitter] },
    };
  }
  const shown = campaignUsd(amount);
  const image = { url: campaignImageUrl(landing.code, amount), ...OG_SIZE, alt: words.alt(shown) };
  return {
    openGraph: { title: words.title(shown), description: words.description, siteName: "Berth", type: "website", images: [image] },
    twitter: { card: "summary_large_image", title: words.title(shown), description: words.description, images: [image] },
  };
}

/**
 * The landing as the card sees it. In `next dev` only, `?preview=` (and
 * `&amount=`) draws a fixture, so each state can be checked without a
 * database, as the page itself allows.
 */
export async function cardLanding(code: string, search: URLSearchParams = new URLSearchParams()): Promise<CampaignLanding> {
  if (overrideAllowed()) {
    const fixture = landingPreview(code, search.get("preview"));
    const amount = Number(search.get("amount"));
    if (fixture?.state === "live" && Number.isFinite(amount) && amount > 0) return { ...fixture, amountUsd: amount };
    if (fixture) return fixture;
  }
  return normalizeCampaignCode(code) ? campaignLanding(code) : { state: "unknown" };
}

let fallback: Promise<ArrayBuffer> | null = null;

/** The home card's PNG, drawn once per process. */
function fallbackBytes(): Promise<ArrayBuffer> {
  fallback ??= ogImage("home")
    .then((response) => response.arrayBuffer())
    .catch((error: unknown) => {
      fallback = null;
      throw error;
    });
  return fallback;
}

/**
 * The whole answer of /og/c/<code>. A live card is drawn only at its own
 * address, the `v` the page names: any other `v`, or none, is sent there
 * (308), so a made up `v` cannot make the server draw it again and again
 * past the edge cache. The fallback is the same cached bytes for any `v`.
 */
export async function campaignCardResponse(code: string, search: URLSearchParams = new URLSearchParams()): Promise<Response> {
  const landing = await cardLanding(code, search);
  const amount = cardAmount(landing);
  if (amount === null || landing.state !== "live") return new Response(await fallbackBytes(), { status: 200, headers: { ...FALLBACK_CARD_HEADERS } });
  // The dev previews (next dev only) draw whatever they are asked.
  const preview = overrideAllowed() && search.has("preview");
  const url = campaignImageUrl(landing.code, amount);
  if (!preview && new URLSearchParams(url.split("?")[1]).get("v") !== search.get("v")) return canonicalRedirect(url);
  const bytes = await (await ogCampaignImage(amount)).arrayBuffer();
  return new Response(bytes, { status: 200, headers: { ...LIVE_CARD_HEADERS } });
}
