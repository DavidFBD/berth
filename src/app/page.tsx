import type { Metadata } from "next";
import { headers } from "next/headers";
import { Home } from "@/components/home";
import { AvailabilityProvider } from "@/components/availability/availability";
import { requestAvailability } from "@/lib/server/availability";
import { normalizeInviteCode } from "@/lib/invite-code";
import { cardPerson } from "@/lib/server/og-people";
import { inviteCardMetadata } from "@/lib/invite-card";

/**
 * Server shell for the client app: it exists so a shared invite link can
 * carry its own social card. `/?ref=CODE` is the legacy carrier (still
 * honoured); freshly minted links use `/r/CODE`, which unfurls the same
 * story from its own route. The same URL without a code keeps the layout's
 * default metadata untouched.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}): Promise<Metadata> {
  const { ref } = await searchParams;
  const code = normalizeInviteCode(ref);
  if (!code) return {};
  const person = await cardPerson("invite", code);
  return inviteCardMetadata(person ? { code, person } : undefined);
}

/**
 * Whether Berth can start something new for this visitor is judged here,
 * from the request's country (lib/server/availability), and handed down:
 * where it cannot, the welcome page, buys and plans become the soft
 * landing, and an existing account keeps seeing, selling and withdrawing.
 * In `next dev` only, `?country=US` stands in for the header.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ country?: string | string[]; region?: string | string[] }>;
}) {
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
  const availability = requestAvailability(await headers(), {
    override: { country: one(params.country), region: one(params.region) },
  });
  return (
    <AvailabilityProvider value={availability}>
      <Home />
    </AvailabilityProvider>
  );
}
