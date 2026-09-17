import type { Metadata } from "next";

/**
 * The saved-seat social card, shared by both invite carriers: the legacy
 * `/?ref=CODE` query shape and the sturdier `/r/CODE` path shape (query
 * params proved strippable in the wild — WhatsApp to desktop Chrome ate one
 * on 2026-08-07; a path segment survives the retelling).
 */

const INVITE_TITLE = "A friend invited you to Berth";
const INVITE_DESCRIPTION =
  "Buy US stocks and funds with the stablecoins you already hold, from any network, in your own custody. Your first trade earns you both a little extra.";
const INVITE_IMAGE = {
  url: "/og-invite.png",
  width: 1200,
  height: 630,
  alt: "The Berth mark beside the words: a seat has been kept for you.",
};

export function inviteCardMetadata(): Metadata {
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
