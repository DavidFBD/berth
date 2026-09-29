import type { Metadata } from "next";
import { FriendsBoardPage } from "@/components/social/friends-board";

/** The friends board: you and your friends, this month (ADR-0005). */
export const metadata: Metadata = {
  title: "Friends board · Berth",
  robots: { index: false, follow: false },
};

export default function FriendsPage() {
  return <FriendsBoardPage />;
}
