import type { Metadata } from "next";
import { ogImageRef, socialCard } from "@/lib/og/metadata";
import { COPY } from "@/lib/copy";
import { ProfilePage } from "@/components/social/profile-page";

/**
 * A friend link: /f/<token>. Opens its owner's profile, where "Add friend"
 * files the request through the link. Its own token, never the referral
 * code (ADR-0005). Never indexed.
 */

export const metadata: Metadata = {
  title: "Berth",
  robots: { index: false, follow: false },
  // Never the name in the address: signed out, Berth does not say whether it exists.
  ...socialCard({
    title: COPY.og.friendLink.title,
    description: COPY.og.friendLink.line,
    image: ogImageRef("/f", COPY.og.friendLink.alt),
  }),
};

type Params = { params: Promise<{ token: string }> };

export default async function FriendLinkPage({ params }: Params) {
  const { token } = await params;
  return <ProfilePage target={{ token }} />;
}
