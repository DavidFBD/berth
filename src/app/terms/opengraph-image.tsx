import { OG_CONTENT_TYPE, OG_SIZE, ogAlt, ogImage } from "@/lib/og/card";

/** The terms link preview card (lib/og/card), built once at build time. */
export const alt = ogAlt("terms");
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage("terms");
}
