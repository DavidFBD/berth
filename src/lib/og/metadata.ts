import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { COPY } from "@/lib/copy";
import { OG_REVISION, OG_SIZE } from "@/lib/og/size";
import type { OgPerson, PersonalKind } from "@/lib/og/card";

/** A short fingerprint of the cards' words and drawing, for `?v=`. */
export const OG_VERSION = createHash("sha256")
  .update(JSON.stringify([OG_REVISION, COPY.og]))
  .digest("hex")
  .slice(0, 12);

/**
 * A card picture by address, for a page whose card lives in a parent
 * segment (app/u/opengraph-image for /u/NAME). Next attaches a segment's
 * own card file on its own, but once a child page sets `openGraph` the
 * parent's file no longer reaches it, so the page names it.
 */
export function ogImageRef(segment: string, alt: string) {
  const base = segment === "/" ? "" : segment;
  return {
    og: { url: `${base}/opengraph-image?v=${OG_VERSION}`, ...OG_SIZE, alt },
    twitter: { url: `${base}/twitter-image?v=${OG_VERSION}`, ...OG_SIZE, alt },
  };
}

/**
 * The words of a page's link preview, for pages that are not the front
 * door. Next merges metadata shallowly, so a page that sets `openGraph`
 * replaces the root's whole object: this gives every page the full set
 * (its own title, description and address, the site name) instead of the
 * front door's title showing on a shared privacy policy. The picture is
 * not here: it comes from the segment's opengraph-image and twitter-image
 * files (lib/og/card), which Next attaches on its own.
 */
export function socialCard({
  title,
  description,
  path,
  image,
}: {
  title: string;
  description: string;
  /** The page's own address, or undefined where the address carries a code. */
  path?: string;
  /** Only where the card file sits in a parent segment; see ogImageRef. */
  image?: ReturnType<typeof ogImageRef>;
}): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      title,
      description,
      ...(path ? { url: path } : {}),
      siteName: "Berth",
      type: "website",
      ...(image ? { images: [image.og] } : {}),
    },
    twitter: { card: "summary_large_image", title, description, ...(image ? { images: [image.twitter] } : {}) },
  };
}

/**
 * A card picture with a person in it (lib/server/og-people), by address.
 * The address carries what the picture shows as `?v=` (the username, the
 * face, the rank and the cards' own version), so a new face or a new rank
 * is a new address and a platform that cached the old picture fetches the
 * new one. `key` is the username as stored or the normalized invite code,
 * never text taken as typed from a URL.
 */
export function personalImageRef(kind: PersonalKind, key: string, person: OgPerson, alt: string) {
  const v = createHash("sha256")
    .update(JSON.stringify([OG_VERSION, kind, person.handle, person.face, person.level, person.rank]))
    .digest("hex")
    .slice(0, 12);
  const url = `/og/${kind === "profile" ? "u" : "r"}/${encodeURIComponent(key)}?v=${v}`;
  return { og: { url, ...OG_SIZE, alt }, twitter: { url, ...OG_SIZE, alt } };
}
