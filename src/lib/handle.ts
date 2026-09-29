import { TOKEN_LISTINGS } from "@/lib/listings";
import { RANKS } from "@/lib/xp";

/**
 * The username rulebook: the ONE statement of what a username is, imported
 * by the picker (client), the server that stores it (lib/server/social) and
 * the card's lookup. Like lib/invite-code, a name that passes here is a name
 * the server can store; a name that fails here never reaches it.
 *
 * Three layers, in order:
 *
 * 1. Shape. NFKC first (so full width and styled letters become plain
 *    ones), then lowercase: a username is lowercase only, stored and shown
 *    that way, like most handles, so no capital I can pose as an l. Then 3
 *    to 20 of a-z, 0-9 and underscore, no underscore at either end.
 * 2. The fold, for uniqueness and lookup only: digits read as the letters
 *    they imitate (0→o, 1→l, 3→e, 4→a, 5→s, 7→t, 8→b), rn→m, vv→w,
 *    underscores dropped. So "harb0_ur" and "harbour", "rnike" and "mike"
 *    are one name each, and whoever holds it is who a lookalike reaches.
 *    Letters are never folded into each other: kai and kal, neil and nell
 *    stay two names.
 * 3. Names nobody may take: house words, the rank names, every listing's
 *    ticker and name, as the whole name; the house's words and the
 *    listings as a word inside a name too, by the token rules at
 *    `impersonates`; and offensive words. Checked on the fold, and once
 *    more with the common letter swaps (1→i, 3→e, 4→a, 7→t, 8→b) undone,
 *    since those are how a slur gets past a list.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

export type HandleShapeError = "short" | "long" | "charset" | "edge";

export type ParsedHandle =
  | { ok: true; handle: string; norm: string }
  | { ok: false; reason: HandleShapeError };

/** Shape only: whether this could be a username at all, and its fold. */
export function parseHandle(value: unknown): ParsedHandle {
  if (typeof value !== "string") return { ok: false, reason: "charset" };
  const handle = value.normalize("NFKC").trim().replace(/^@/, "").toLowerCase();
  if (handle.length < HANDLE_MIN) return { ok: false, reason: "short" };
  if (handle.length > HANDLE_MAX) return { ok: false, reason: "long" };
  if (!/^[a-z0-9_]+$/.test(handle)) return { ok: false, reason: "charset" };
  if (handle.startsWith("_") || handle.endsWith("_")) return { ok: false, reason: "edge" };
  const norm = foldHandle(handle);
  // "a_b" folds to two letters: too short to be told apart from anything.
  if (norm.length < HANDLE_MIN) return { ok: false, reason: "short" };
  return { ok: true, handle, norm };
}

const DIGIT_LOOKS: Record<string, string> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };

/** The lookalike swaps, on a lowercase name: digits to the letters they imitate, rn to m, vv to w. */
function foldChars(lower: string): string {
  return lower.replace(/[0134578]/g, (digit) => DIGIT_LOOKS[digit]).replace(/rn/g, "m").replace(/vv/g, "w");
}

/** The comparison form. Assumes the shape already passed. */
export function foldHandle(handle: string): string {
  return foldChars(handle.normalize("NFKC").toLowerCase().replace(/_/g, ""));
}

/**
 * The fold a lookup uses: the same fold, applied to whatever was typed or
 * sits in the URL, or null when it could never be a username. A lookup
 * never searches, never matches a prefix, never suggests.
 */
export function lookupKey(value: unknown): string | null {
  const parsed = parseHandle(typeof value === "string" ? safeDecode(value) : value);
  return parsed.ok ? parsed.norm : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const HOUSE = [
  "berth", "berthmarkets", "sodax", "admin", "administrator", "support", "staff", "help", "helpdesk",
  "team", "official", "moderator", "mod", "mods", "security", "safety", "abuse", "legal", "privacy",
  "terms", "billing", "payments", "wallet", "wallets", "account", "accounts", "settings", "profile",
  "profiles", "friends", "friend", "board", "salute", "salutes", "system", "root", "owner", "api",
  "www", "mail", "email", "news", "jev", "typesafe", "assistant", "claude", "chatgpt", "grok",
  "openai", "anthropic", "robinhood", "sonic", "privy", "null", "undefined", "anonymous", "everyone",
  "nobody", "someone", "me", "you", "hidden", "member", "members", "deleted", "unknown", "dev",
];

/** Every rank name, spaces dropped: "Harbour Master" is not a username. */
const RANK_NAMES = RANKS.map((rank) => rank.name.replace(/\s+/g, ""));

/** Every listing's ticker and plain name, so nobody can pose as the stock. */
const LISTING_NAMES = TOKEN_LISTINGS.flatMap((listing) => [listing.symbol, listing.name, listing.issuerName]);

/**
 * Stems refused anywhere in a name. Each is long or rare enough not to sit
 * inside an ordinary word; anything shorter lives in OFFENSIVE_WORDS.
 */
const OFFENSIVE_STEMS = [
  "fuck", "shit", "cunt", "nigger", "nigga", "faggot", "retard", "whore", "slut", "rapist",
  "hitler", "chink", "gook", "wetback", "spastic", "tranny", "bitch", "bastard", "twat", "pussy",
  "dildo", "porn", "hentai", "paedo", "paedophile", "pedophile", "molest", "incest", "bestial",
  "jihad", "kkk", "siegheil", "genocide", "terrorist",
];

/** Short words refused only as the whole name or as one underscore segment. */
const OFFENSIVE_WORDS = [
  "ass", "arse", "anal", "anus", "cum", "fag", "fags", "tit", "tits", "piss", "dick", "dicks",
  "sex", "sexy", "nude", "nudes", "penis", "vagina", "boob", "boobs", "coon", "spic", "homo",
  "negro", "jap", "paki", "hoe", "hoes", "scam", "scammer", "kys", "rape", "raped", "cock", "cocks",
  "pedo", "nazi", "nazis", "kike", "dyke", "isis", "wank", "wanker",
];

/**
 * Impersonation is judged on words, not on letters inside words, so steam,
 * teammate, pineapple and badminton are ordinary names. A name is split
 * into tokens at underscores and digits; it is refused when a token is one
 * of these house words or a listing's ticker or name, when it starts with a
 * house word joined straight to another house word or an official sounding
 * suffix (berthsupport, sodaxhq), when it starts with sodax at all, or when
 * it ends with a house word that no ordinary word ends in (cybersupport).
 */
const HOUSE_WORDS = ["berth", "sodax", "support", "admin", "official", "moderator", "team", "staff", "robinhood"];
const LISTING_TOKENS = TOKEN_LISTINGS.flatMap((listing) => [listing.symbol, listing.name]).map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ""));
const TOKEN_REFUSED = new Set([...HOUSE_WORDS, ...LISTING_TOKENS]);
/** What may not be joined straight onto a house word at the start of a name. */
const OFFICIAL_SUFFIXES = ["hq", "app", "help", "desk", "mod", "mods", "bot", "news", "info", "labs", "crew", "official"];
/** Always refused at the start: not the start of any ordinary word. */
const STARTS_REFUSED = ["sodax"];
/** Refused at the end: house words no ordinary word ends in (unlike team, in steam). */
const ENDS_REFUSED = ["support", "admin", "moderator", "official", "berth", "sodax"];

function impersonates(handle: string): boolean {
  const swapped = unleetKeep(handle);
  const tokens = [...handle.split(/[_0-9]+/), ...swapped.split(/[_0-9]+/)].filter(Boolean);
  if (tokens.some((token) => TOKEN_REFUSED.has(token))) return true;
  const joined = swapped.replace(/_/g, "");
  if (STARTS_REFUSED.some((word) => joined.startsWith(word))) return true;
  if (ENDS_REFUSED.some((word) => joined.endsWith(word))) return true;
  for (const word of HOUSE_WORDS) {
    if (!swapped.startsWith(word)) continue;
    const rest = swapped.slice(word.length);
    if (/^[_0-9]/.test(rest)) return true;
    const next = rest.replace(/^_+/, "");
    if ([...HOUSE_WORDS, ...OFFICIAL_SUFFIXES].some((suffix) => next.startsWith(suffix))) return true;
  }
  return false;
}

/** A list entry in plain lowercase letters and digits. */
const plain = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Each list in the two forms a name is checked in: folded (against the
 * name's fold) and plain (against the name with its letter swaps undone).
 */
function both(values: readonly string[], minLength = 0) {
  const raw = values.map(plain).filter((value) => value.length >= minLength);
  return { raw, folded: raw.map(foldChars) };
}

const RESERVED = both([...HOUSE, ...RANK_NAMES, ...LISTING_NAMES]);
const RESERVED_SETS = { raw: new Set(RESERVED.raw), folded: new Set(RESERVED.folded) };
const STEMS = both(OFFENSIVE_STEMS);
const WORDS = both(OFFENSIVE_WORDS);
const WORD_SETS = { raw: new Set(WORDS.raw), folded: new Set(WORDS.folded) };

/**
 * The name with the usual letter swaps undone (0→o, 1→i, 3→e, 4→a, 5→s,
 * 7→t, 8→b), underscores kept: how "b3rth_supp0rt" is read as words.
 */
function unleetKeep(handle: string): string {
  const swaps: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };
  return handle.normalize("NFKC").toLowerCase().replace(/[0134578]/g, (digit) => swaps[digit]);
}

/** The same, underscores dropped: the second form every list is checked on. */
function unleet(handle: string): string {
  return unleetKeep(handle).replace(/_/g, "");
}

/** Whether the fixed lists refuse this name, and which list. Pass the parsed handle. */
export function refusedName(parsed: { handle: string; norm: string }): "reserved" | "offensive" | null {
  const folded = parsed.norm;
  const raw = unleet(parsed.handle);
  const segments = parsed.handle.split("_");
  const has = (list: { raw: string[]; folded: string[] }) =>
    list.folded.some((stem) => folded.includes(stem)) || list.raw.some((stem) => raw.includes(stem));
  if (has(STEMS)) return "offensive";
  const wordHit = (value: string, form: "raw" | "folded") => WORD_SETS[form].has(value);
  if (
    wordHit(folded, "folded") ||
    wordHit(raw, "raw") ||
    segments.some((segment) => wordHit(foldHandle(segment), "folded") || wordHit(unleet(segment), "raw"))
  )
    return "offensive";
  if (RESERVED_SETS.folded.has(folded) || RESERVED_SETS.raw.has(raw) || impersonates(parsed.handle)) return "reserved";
  return null;
}

/** Why a name cannot be picked, as the picker says it and the server answers it. */
export type HandleRefusal = HandleShapeError | "offensive" | "taken" | "cooldown" | "noEmail";

/** Name changes are one per this many days, whatever the change. */
export const HANDLE_CHANGE_DAYS = 30;
/** A name dropped by a change is held this long for its last owner. */
export const HANDLE_RETIRE_DAYS = 90;
