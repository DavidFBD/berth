import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CampaignLanding } from "@/components/campaign-landing";
import { campaignLanding } from "@/lib/server/campaigns/store";
import { overrideAllowed, requestAvailability } from "@/lib/server/availability";
import { landingPreview } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Berth",
  robots: { index: false, follow: false },
};

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
 * In `next dev` only, `?preview=live|full|ended|paused|unknown` shows that
 * state from a fixture, so each can be shot without a database.
 */
type Params = { params: Promise<{ code: string }>; searchParams: Promise<{ preview?: string | string[] }> };

export default async function CampaignPage({ params, searchParams }: Params) {
  const { code } = await params;
  const { preview } = await searchParams;
  const requestHeaders = await headers();
  if (!requestAvailability(requestHeaders).available) redirect("/");
  const fixture = overrideAllowed() ? landingPreview(code, typeof preview === "string" ? preview : null) : null;
  return <CampaignLanding landing={fixture ?? (await campaignLanding(code))} />;
}
