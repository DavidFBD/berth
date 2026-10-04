"use client";

import { Suspense } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { CampaignsQueueView } from "@/components/staff/campaigns-queue";
import { CampaignLineView } from "@/components/board/campaign-line";
import { campaignLine } from "@/lib/campaigns";
import { BalanceReaderProvider } from "@/components/staff/campaign-funding";
import { BALANCE_FIXTURE, CREATE_PREFILL, LINE_FIXTURES, QUEUE_FIXTURE } from "./fixtures";
import { useMounted } from "@/hooks/use-mounted";

/**
 * Dev-only gallery of the campaign screens, from fixtures (404 in prod). No
 * request leaves the page; buttons do nothing. Every account, address and
 * hash below is invented.
 *
 *   /dev/campaigns              the staff review queue
 *   /dev/campaigns?view=lines   every home line, in order
 *   /dev/campaigns?create=open  the create form open, its Funding block filled
 *                               (&address=0x... to judge another address)
 *
 * The lines in the calm home's own layout: /dev/board?home=new&campaign=rules
 * (rules, email, holding, qualified, paid, closed).
 */

export default function CampaignsGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <Gallery />
    </Suspense>
  );
}

function Gallery() {
  const params = useSearchParams();
  // Dates are drawn in the browser's own time zone: after mount only, so the server's never disagrees.
  const mounted = useMounted();
  if (!mounted) return null;
  if (params.get("view") === "lines") {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-8 lg:max-w-xl">
        {Object.entries(LINE_FIXTURES).map(([name, fixture]) => (
          <CampaignLineView key={name} line={campaignLine(fixture)} />
        ))}
      </div>
    );
  }
  const prefill = params.get("create") === "open" ? { ...CREATE_PREFILL, ...(params.has("address") ? { payoutAddress: params.get("address") ?? "" } : {}) } : undefined;
  return (
    <BalanceReaderProvider reader={async (address) => BALANCE_FIXTURE[address.toLowerCase()] ?? { outcome: "unreachable", error: "fixture" }}>
      <CampaignsQueueView queue={QUEUE_FIXTURE} onAction={() => undefined} createPrefill={prefill} />
    </BalanceReaderProvider>
  );
}
