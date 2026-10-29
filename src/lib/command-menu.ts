import { listingNameForms, type TokenListing } from "@/lib/listings";

/**
 * The command menu's pure half: how a typed query ranks the listings, which
 * key press opens the menu, and when a press is left alone. The component
 * (components/command-menu) only draws what this decides.
 */

/** How well a query matched, best first. */
export type MatchRank = "exact-ticker" | "name-prefix" | "word-prefix" | "ticker" | "substring";

const RANK_ORDER: Record<MatchRank, number> = { "exact-ticker": 0, "name-prefix": 1, "word-prefix": 2, ticker: 3, substring: 4 };

const fold = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();

/** The words of a name, split on anything that is not a letter or a digit. */
const wordsOf = (name: string) => fold(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The best rank one listing earns for a folded, non-empty query, or null. */
export function rankOf(listing: TokenListing, query: string): MatchRank | null {
  const q = fold(query);
  if (!q) return null;
  const symbol = listing.symbol.toLowerCase();
  if (symbol === q) return "exact-ticker";
  const forms = [...new Set([listing.name, ...listingNameForms(listing)])];
  const folded = forms.map(fold);
  if (folded.some((name) => name.startsWith(q))) return "name-prefix";
  if (forms.some((name) => wordsOf(name).some((word) => word.startsWith(q)))) return "word-prefix";
  if (symbol.startsWith(q)) return "ticker";
  if (folded.some((name) => name.includes(q)) || symbol.includes(q)) return "substring";
  return null;
}

/**
 * Listings for a query: an exact ticker, then name prefix, then word prefix, then ticker, then
 * substring; the registry's order breaks ties. An empty query returns the
 * first `limit` listings in registry order, so the menu is never blank.
 */
export function searchListings(listings: readonly TokenListing[], query: string, limit = 8): TokenListing[] {
  if (!fold(query)) return listings.slice(0, limit);
  const scored: { listing: TokenListing; rank: number; index: number }[] = [];
  listings.forEach((listing, index) => {
    const rank = rankOf(listing, query);
    if (rank) scored.push({ listing, rank: RANK_ORDER[rank], index });
  });
  scored.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return scored.slice(0, limit).map((entry) => entry.listing);
}

/** The slice of a keyboard event the shortcut reads. */
export type KeyLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** Whether this platform string is a Mac, iPad or iPhone (Command, not Control). */
export function isApplePlatform(platform: string | undefined): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform ?? "");
}

/** Command K on a Mac, Control K elsewhere; no other modifier alongside. */
export function isCommandMenuKey(event: KeyLike, apple: boolean): boolean {
  if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey) return false;
  return apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** The label the hint chip shows; `otherLabel` is the words for Control K, from COPY. */
export function shortcutLabel(apple: boolean, otherLabel: string): string {
  return apple ? "⌘K" : otherLabel;
}

/** The slice of an element the typing check reads. */
export type FocusLike = { tagName?: string; isContentEditable?: boolean; getAttribute?: (name: string) => string | null } | null | undefined;

/** Whether focus is somewhere a person is typing text. */
export function isTypingTarget(target: FocusLike): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target.getAttribute?.("type") ?? "text").toLowerCase();
    return !["button", "checkbox", "radio", "submit", "reset", "range", "image", "file"].includes(type);
  }
  if (target.isContentEditable) return true;
  const editable = target.getAttribute?.("contenteditable");
  return editable !== null && editable !== undefined && editable !== "false";
}

/**
 * What a Command K press does. While the menu is open the press closes it,
 * even from its own search box; closed, it opens only when nobody is typing
 * and no signing window or order drawer holds the screen.
 */
export function shortcutAction(input: {
  event: KeyLike;
  apple: boolean;
  open: boolean;
  target: FocusLike;
  busy: boolean;
}): "open" | "close" | "ignore" {
  if (!isCommandMenuKey(input.event, input.apple)) return "ignore";
  if (input.open) return "close";
  if (input.busy || isTypingTarget(input.target)) return "ignore";
  return "open";
}

/** Where arrow keys land: wraps at both ends; -1 when there is nothing to pick. */
export function moveIndex(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}
