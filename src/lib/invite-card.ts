import type { Metadata } from "next";
import { COPY } from "@/lib/copy";
import { ogImageRef } from "@/lib/og/metadata";

/**
 * The saved-seat social card, shared by both invite carriers: the legacy
 * `/?ref=CODE` query shape and the sturdier `/r/CODE` path shape (query
 * params proved strippable in the wild — WhatsApp to desktop Chrome ate one
 * on 2026-08-07; a path segment survives the retelling).
 */

const INVITE_TITLE = "A friend invited you to Berth";
const INVITE_DESCRIPTION =
  "Wall Street, in your wallet. Buy US stocks with the crypto you hold, on more than 20 networks, and keep them in your own wallet. Your first trade earns you both XP.";

/**
 * The invite card picture is app/r/opengraph-image.tsx (lib/og/card). The
 * `/?ref=CODE` carrier sits on the front door and /r/CODE below the /r
 * segment, so both name the picture by its address.
 */
const INVITE_IMAGE = ogImageRef("/r", COPY.og.invite.alt);

export function inviteCardMetadata(): Metadata {
  return {
    title: INVITE_TITLE,
    description: INVITE_DESCRIPTION,
    openGraph: {
      title: INVITE_TITLE,
      description: INVITE_DESCRIPTION,
      siteName: "Berth",
      type: "website",
      images: [INVITE_IMAGE.og],
    },
    twitter: {
      card: "summary_large_image",
      title: INVITE_TITLE,
      description: INVITE_DESCRIPTION,
      images: [INVITE_IMAGE.twitter],
    },
  };
}
