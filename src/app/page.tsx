import type { Metadata } from "next";
import { Home } from "@/components/home";
import { isInviteCode } from "@/lib/invite-code";
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
  if (!isInviteCode(ref)) return {};
  return inviteCardMetadata();
}

export default function Page() {
  return <Home />;
}
