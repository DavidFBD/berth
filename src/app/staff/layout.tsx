import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * The staff area (docs/adr/0008-staff-area.md). Nothing here renders
 * anything of its own: every page checks the staff gate itself
 * (lib/server/staff-gate staffGate) and draws the shell only after it.
 * Never indexed, never cached (next.config headers as well).
 */

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default function StaffLayout({ children }: { children: ReactNode }) {
  return children;
}
