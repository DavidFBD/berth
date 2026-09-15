import type { Metadata } from "next";
import { LorePage } from "@/components/lore-page";

/**
 * The legend lives OUTSIDE the sign-in gate on purpose: it's the shareable
 * front porch of the tea house, readable (and unfurlable) by anyone. The
 * telling itself follows the visitor's chosen mode, all eight voices.
 */

const TITLE = "The Legend of LSTeaTime";
const DESCRIPTION =
  "How a tea house came to pour across twenty networks: the founding, the blends, the kitchen that carries every tray, and the house rules by the door.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function Page() {
  return <LorePage />;
}
