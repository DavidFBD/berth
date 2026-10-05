/**
 * X's post intent: a link that opens X's own composer with words and a
 * link filled in, which the person can change or close. Berth posts
 * nothing, calls no X API and rewards nothing for it (X's developer policy
 * forbids paying for a post, and Berth never pays for any X action). A
 * personal invite never earns its sharer money (campaigns pay only the new
 * account opened through a campaign's own link), so these posts carry no
 * reward disclosure.
 */
export const X_POST_INTENT = "https://x.com/intent/post";

export function xPostIntent(text: string, url: string): string {
  return `${X_POST_INTENT}?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/** The invite post's words: the one calm line. */
export function inviteXWords(copy: { inviteXText: string }): string {
  return copy.inviteXText;
}

/** X's post limit, and the weight it gives any link (t.co), whatever its length. */
export const X_POST_LIMIT = 280;
export const X_LINK_WEIGHT = 23;
/** Names a holdings post spells out; the rest are counted ("and three more"). */
export const HOLDINGS_X_NAMED = 5;

/**
 * A text's weight as X counts it: one per character in the Latin, Greek and
 * Cyrillic ranges and common punctuation, two for anything else (CJK,
 * emoji). Close enough to X's own counter for the plain words Berth writes.
 */
export function xWeight(text: string): number {
  let weight = 0;
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    const light =
      point <= 0x10ff || (point >= 0x2000 && point <= 0x200d) || (point >= 0x2010 && point <= 0x201f) || (point >= 0x2032 && point <= 0x2037);
    weight += light ? 1 : 2;
  }
  return weight;
}

type HoldingsXCopy = {
  holdingsXText: (list: string, count: number) => string;
  holdingsXList: (names: readonly string[], more: number) => string;
};

/**
 * The words for "Share what you hold on X": one calm first person line
 * naming the chosen holdings by name, never an amount, a value, a price or
 * a return.
 * Up to five names are spelled out, the rest counted; if the post would
 * still pass 280 with the link (weighed as 23), the list is shortened, never
 * the sentence. Empty when nothing is chosen.
 */
export function holdingsXWords(copy: HoldingsXCopy, names: readonly string[]): string {
  if (names.length === 0) return "";
  const words = (named: number) => copy.holdingsXText(copy.holdingsXList(names.slice(0, named), names.length - named), names.length);
  let named = Math.min(names.length, HOLDINGS_X_NAMED);
  while (named > 1 && xWeight(words(named)) + 1 + X_LINK_WEIGHT > X_POST_LIMIT) named -= 1;
  return words(named);
}
