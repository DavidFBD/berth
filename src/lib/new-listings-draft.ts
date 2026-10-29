import { COPY } from "@/lib/copy";
import { TOKEN_LISTINGS } from "@/lib/listings";

/**
 * The words of a New stocks announcement staff may edit (subject, preview
 * line, intro, an extra paragraph), their defaults from copy.ts, and the
 * rules they must keep. Pure: the staff page checks as it types and the
 * server (lib/server/new-listings) checks again before anything is saved.
 * The risk line, the why line, the sender line and the unsubscribe are
 * fixed (lib/server/email/compose) and are never part of a draft.
 */

export type DraftWords = { subject: string; preview: string; intro: string; extra: string };

export const DRAFT_LIMITS = { subject: 70, preview: 120, intro: 200, extra: 600 } as const;

/** The default words for `count` stocks, from copy.ts. */
export function defaultWords(count: number): DraftWords {
  const words = COPY.email.newListings;
  return { subject: words.subject([], count), preview: words.preview([], count), intro: words.intro(count), extra: "" };
}

// Dashes as punctuation: a hyphen set apart by spaces, at either end or before a word, a doubled one,
// and the en, em, figure and horizontal bar dashes. A hyphen inside a word (Coca-Cola) is not one.
const DASHES = /(^|\s)-+(\s|$)|--|\s-(?=\p{L})|[\u2012\u2013\u2014\u2015]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
// Berth never asks anyone to buy, invest or act: not as a call to action, and not in a sentence either.
const CALL_TO_ACT = new RegExp(
  `\\b(${[
    "buy|buys|buying|bought",
    "invest|invests|investing|investment|investments|investor|investors",
    "trade|trades|traded|trading|trader|traders",
    "purchase|purchases|purchased|purchasing",
    "get|gets|getting",
    "grab|grabs|grabbing",
    "own|owning",
    "claim|claims",
    "act now|act fast|hurry|sign up",
    "don'?t miss|do not miss|don'?t wait|do not wait",
    "today only|limited time|last chance|while (it )?lasts|before (it'?s|they'?re) gone",
  ].join("|")})\\b`,
  "i",
);
const LINK = /https?:|www\./i;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The listed names, and tickers in capitals, that the subject and the preview line must not carry (names, not stocks, in an inbox line). */
function listingProblem(text: string, listings: typeof TOKEN_LISTINGS): string | null {
  for (const listing of listings) {
    if (listing.kind !== "stock") continue;
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(listing.name)}($|[^\\p{L}\\p{N}])`, "iu").test(text)) return listing.name;
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(listing.symbol)}($|[^\\p{L}\\p{N}])`, "u").test(text)) return listing.symbol;
  }
  return null;
}

/** What is wrong with one field's text, in a plain sentence, or null. */
export function wordsProblem(field: keyof DraftWords, value: string, listings: typeof TOKEN_LISTINGS = TOKEN_LISTINGS): string | null {
  const text = value.trim();
  if (field !== "extra" && text.length === 0) return `The ${fieldName(field)} cannot be empty.`;
  if (text.length > DRAFT_LIMITS[field]) return `The ${fieldName(field)} is longer than ${DRAFT_LIMITS[field]} characters.`;
  if (DASHES.test(text)) return `The ${fieldName(field)} uses a dash as punctuation. Use commas and periods.`;
  if (EMOJI.test(text)) return `The ${fieldName(field)} has an emoji. Berth emails carry none.`;
  if (text.includes("!")) return `The ${fieldName(field)} has an exclamation mark. Berth is calm.`;
  if (CALL_TO_ACT.test(text)) return `The ${fieldName(field)} asks for something (buy, invest, trade, get, own and the like). Berth tells what it lists and asks for nothing.`;
  if (field === "subject" || field === "preview") {
    const named = listingProblem(text, listings);
    if (named) return `The ${fieldName(field)} names a stock (${named}). Keep the stocks' names out of the inbox line; the email itself names them.`;
  }
  if (LINK.test(text)) return `The ${fieldName(field)} has a link. The email carries only Berth's own button.`;
  if (field !== "extra" && /[\r\n]/.test(text)) return `The ${fieldName(field)} must be one line.`;
  return null;
}

function fieldName(field: keyof DraftWords): string {
  return field === "extra" ? "extra paragraph" : field === "preview" ? "preview line" : field;
}

/** Every problem with a draft's words and its chosen count, in field order. */
export function draftProblems(words: DraftWords, chosenCount: number, listings: typeof TOKEN_LISTINGS = TOKEN_LISTINGS): string[] {
  const problems: string[] = [];
  if (chosenCount < 1) problems.push("Tick at least one stock.");
  for (const field of ["subject", "preview", "intro", "extra"] as const) {
    const problem = wordsProblem(field, words[field], listings);
    if (problem) problems.push(problem);
  }
  return problems;
}
