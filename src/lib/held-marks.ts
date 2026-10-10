import { TOKEN_LISTINGS } from "@/lib/listings";

/** How many marks sit beside the legend before the rest becomes "+N". */
export const HELD_MARKS_SHOWN = 5;

/**
 * Which holdings the legend shows as marks: the listings held at the latest
 * point, in the registry's order (so the order says nothing about size),
 * up to `max`, and how many more there are. Unknown symbols keep their
 * place after the known ones. Never an amount.
 */
export function heldMarks(held: readonly string[] | undefined, max = HELD_MARKS_SHOWN): { shown: string[]; more: number } {
  const unique = [...new Set(held ?? [])];
  const order = new Map(TOKEN_LISTINGS.map((listing, index) => [listing.symbol, index]));
  const sorted = unique.sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || a.localeCompare(b));
  // "+1" would take the place of the mark it stands for: show it instead.
  const take = sorted.length === max + 1 ? sorted.length : max;
  return { shown: sorted.slice(0, take), more: Math.max(0, sorted.length - take) };
}
