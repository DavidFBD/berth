/** The link preview size every platform asks for, kept apart from the renderer so metadata can name it cheaply. */
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

/**
 * Bump when the card's drawing changes (lib/og/card). Pages that name a
 * card by its address (an invite on the front door, a profile) carry it as
 * `?v=`, with a hash of the words, so a platform that cached the old card
 * by URL fetches the new one.
 */
export const OG_REVISION = 1;
