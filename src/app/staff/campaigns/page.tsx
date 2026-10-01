import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { StaffCampaigns } from "@/components/staff/campaigns-queue";
import { STAFF_PAGE_COOKIE, staffPagePass } from "@/lib/server/staff-page";

export const dynamic = "force-dynamic";

// No title of its own: nothing about this page may reach a response before its gate.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The campaign review queue, for staff (lib/server/staff-auth). The proxy
 * (src/proxy.ts) already rewrote anyone without a pass to an unknown
 * path; this asks again. To anyone without a live staff pass (lib/server/staff-page: set on the profile
 * sync of an account on STAFF_ADMIN_IDS) this is Next's own 404, exactly
 * as an unknown path. Even with the pass the page holds nothing: what it
 * shows comes from /api/staff/campaigns, which asks requireStaff again.
 */
export default async function StaffCampaignsPage() {
  if (!(await staffPagePass((await cookies()).get(STAFF_PAGE_COOKIE)?.value))) notFound();
  return <StaffCampaigns />;
}
