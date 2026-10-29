import type { Metadata } from "next";
import { StaffEmails } from "@/components/staff/emails-page";
import { StaffShell } from "@/components/staff/shell";
import { staffGate } from "@/lib/server/staff-gate";

export const dynamic = "force-dynamic";

// No title of its own: nothing about this page may reach a response before its gate.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The New stocks email, inside the staff area (docs/adr/0008-staff-area.md).
 * The proxy and next.config already answered anyone without a live staff
 * session as an unknown path; this asks again, for an admin. The page holds
 * nothing itself: what it shows comes from /api/staff/emails.
 */
export default async function StaffEmailsPage() {
  const staff = await staffGate("page", "admin");
  return (
    <StaffShell staff={staff} active="emails">
      <StaffEmails />
    </StaffShell>
  );
}
