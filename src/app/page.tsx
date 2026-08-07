import type { Metadata } from "next";
import { Home } from "@/components/home";

/**
 * Server shell for the client app: it exists so a shared invite link
 * (`/?ref=CODE`) can carry its own social card. A crawler unfurling the
 * link sees the saved-seat story; the same URL without a code keeps the
 * layout's default metadata untouched.
 */

const INVITE_TITLE = "A seat's been saved for you · LSTeaTime";
const INVITE_DESCRIPTION =
  "A friend set a place for you at the tea table. Cups that earn while they steep, and your first pour pays you both a little extra.";
const INVITE_IMAGE = {
  url: "/og-invite.png",
  width: 1200,
  height: 630,
  alt: "Two tea cups on a table, one steaming and one waiting, beside the words: a seat's been saved for you.",
};

// Same shape the client-side pocket accepts; anything else is just noise in
// the URL and gets the default card.
const CODE_SHAPE = /^[a-z0-9]{6,12}$/i;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}): Promise<Metadata> {
  const { ref } = await searchParams;
  if (typeof ref !== "string" || !CODE_SHAPE.test(ref)) return {};
  return {
    title: INVITE_TITLE,
    description: INVITE_DESCRIPTION,
    openGraph: {
      title: INVITE_TITLE,
      description: INVITE_DESCRIPTION,
      images: [INVITE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: INVITE_TITLE,
      description: INVITE_DESCRIPTION,
      images: [INVITE_IMAGE.url],
    },
  };
}

export default function Page() {
  return <Home />;
}
