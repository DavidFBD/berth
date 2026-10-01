import type { Metadata } from "next";
import { ogImageRef, personalImageRef, socialCard } from "@/lib/og/metadata";
import { cardPerson } from "@/lib/server/og-people";
import { COPY } from "@/lib/copy";
import { ProfilePage } from "@/components/social/profile-page";

/**
 * A profile: /u/<username>. The server sends a shell and nothing about the
 * person; the browser asks for the card (lib/server/social), so what shows
 * is decided with the viewer's session in hand. Never indexed.
 */

type Params = { params: Promise<{ username: string }> };

/**
 * Never the name in the address: signed out, Berth does not say whether it
 * exists. Only an owner who turned on "Show my face and rank on links to
 * my profile" gets a card of their own, named as stored (lib/server/og-people);
 * every other name, real or not, gets the one anonymous card.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  const person = await cardPerson("profile", username);
  const base: Metadata = { title: "Berth", robots: { index: false, follow: false } };
  if (!person) {
    return {
      ...base,
      ...socialCard({
        title: COPY.og.profile.title,
        description: COPY.og.profile.line,
        image: ogImageRef("/u", COPY.og.profile.alt),
      }),
    };
  }
  const words = COPY.og.profileOwner;
  return {
    ...base,
    ...socialCard({
      title: words.title(person.handle),
      description: words.line(person.rank),
      image: personalImageRef("profile", person.handle, person, words.alt(person.handle, person.rank)),
    }),
  };
}

export default async function UserPage({ params }: Params) {
  const { username } = await params;
  return <ProfilePage target={{ handle: username }} />;
}
