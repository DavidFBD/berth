import type { Metadata } from "next";
import { ProfilePage } from "@/components/social/profile-page";

/**
 * A friend link: /f/<token>. Opens its owner's profile, where "Add friend"
 * files the request through the link. Its own token, never the referral
 * code (ADR-0005). Never indexed.
 */

export const metadata: Metadata = {
  title: "Berth",
  robots: { index: false, follow: false },
};

type Params = { params: Promise<{ token: string }> };

export default async function FriendLinkPage({ params }: Params) {
  const { token } = await params;
  return <ProfilePage target={{ token }} />;
}
