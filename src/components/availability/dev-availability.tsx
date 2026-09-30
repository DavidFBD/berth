"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AvailabilityProvider } from "@/components/availability/availability";
import { availabilityFor } from "@/lib/availability";

/**
 * Dev galleries only (they 404 in production): `?country=US` (and
 * `&region=43`) sets the availability the soft landing reads, so it can be
 * reviewed and shot without a Vercel country header. Needs a Suspense
 * boundary above it, as any useSearchParams reader does.
 */
export function DevAvailability({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  return (
    <AvailabilityProvider value={availabilityFor(params.get("country"), params.get("region"))}>
      {children}
    </AvailabilityProvider>
  );
}
