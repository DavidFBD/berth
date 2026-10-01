import { OG_CONTENT_TYPE, OG_SIZE, ogAlt, ogImage } from "@/lib/og/card";

/** The profile link preview card (lib/og/card), built once at build time. */
export const alt = ogAlt("profile");
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage("profile");
}
