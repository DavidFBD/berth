import type { Metadata } from "next";
import { headers } from "next/headers";
import { permanentRedirect, redirect } from "next/navigation";
import { CampaignLanding } from "@/components/campaign-landing";
import { campaignLanding, renamedCampaignCode } from "@/lib/server/campaigns/store";
import { overrideAllowed, requestAvailability } from "@/lib/server/availability";
import { landingPreview } from "@/lib/campaigns";
import { countLinkOpen } from "@/lib/server/campaigns/link-opens";
import { campaignCardMetadata, cardLanding } from "@/lib/server/og-campaign";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }>; searchParams: Promise<{ preview?: string | string[] }> };

/**
 * The link preview: a live campaign's own card with its amount, anything
 * else the home card (lib/server/og-campaign). summary_large_image either way.
 */
export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { code } = await params;
  const { preview } = await searchParams;
  const search = new URLSearchParams(typeof preview === "string" ? { preview } : {});
  const landing = await cardLanding(code, search).catch(() => ({ state: "unknown" }) as const);
  return { title: "Berth", robots: { index: false, follow: false }, ...campaignCardMetadata(landing) };
}

/**
 * A campaign link, /c/<code> (lib/campaigns, lib/server/campaigns). A calm
 * page that stays up: a live signup campaign states its offer and short
 * rules, and its code is pocketed; anything else (full, ended, paused or
 * no such offer) says so plainly, pockets nothing and still lets the
 * person go on to sign up, so no promise is made that the server would not
 * keep. A visit from where Berth is not available steps straight through
 * to the front door. The pocketed code is what makes a new account's
 * claim, on its first sync: no code, no claim.
 *
 * Each render here is one link open on the staff campaign card
 * (lib/server/campaigns/link-opens): a per campaign, per day count, with
 * nothing about the visitor kept. Previews below are not counted.
 *
 * In `next dev` only, `?preview=live|full|ended|paused|unknown` shows that
 * state from a fixture, so each can be shot without a database.
 */

export default async function CampaignPage({ params, searchParams }: Params) {
  const { code } = await params;
  const { preview } = await searchParams;
  const requestHeaders = await headers();
  if (!requestAvailability(requestHeaders).available) redirect("/");
  const fixture = overrideAllowed() ? landingPreview(code, typeof preview === "string" ? preview : null) : null;
  if (fixture) return <CampaignLanding landing={fixture} />;
  // A link staff changed since: the old one opens the new one (308), and is counted there.
  const renamed = await renamedCampaignCode(code).catch(() => null);
  if (renamed) permanentRedirect(`/c/${renamed}`);
  // One more open on the staff card's counter, after the response; no visitor data is kept.
  countLinkOpen(code, requestHeaders);
  return <CampaignLanding landing={await campaignLanding(code)} />;
}
