import { createHash } from "node:crypto";
import type { Metadata } from "next";
import { COPY } from "@/lib/copy";
import { OG_REVISION, OG_SIZE } from "@/lib/og/size";

/** A short fingerprint of the cards' words and drawing, for `?v=`. */
const OG_VERSION = createHash("sha256")
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
