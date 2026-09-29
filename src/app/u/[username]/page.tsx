import type { Metadata } from "next";
import { ProfilePage } from "@/components/social/profile-page";

/**
 * A profile: /u/<username>. The server sends a shell and nothing about the
 * person; the browser asks for the card (lib/server/social), so what shows
 * is decided with the viewer's session in hand. Never indexed.
 */

export const metadata: Metadata = {
  title: "Berth",
  robots: { index: false, follow: false },
};

type Params = { params: Promise<{ username: string }> };

export default async function UserPage({ params }: Params) {
  const { username } = await params;
  return <ProfilePage target={{ handle: username }} />;
}
