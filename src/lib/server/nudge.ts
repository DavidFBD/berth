import { substanceToWeight } from "@/lib/news-judge";
import { CASH_SYMBOL, eligibleKinds, type Nudge, type NudgeFacts, type NudgeKind } from "@/lib/nudge";
import { cachedVerdict, fingerprint, type ChoiceQuestion } from "@/lib/server/jev";
import { NAMES, readCards } from "@/lib/server/news-read";
import { forListing, type StoryCard } from "@/lib/news-stories";

/**
 * Which one line to say, for one account, right now.
 *
 * Code first: `eligibleKinds` decides what is true of the account, and
 * which news about held listings is worth a line is code too, from the
 * verdicts the news store already holds (lib/server/news-read): material
 * news, or a new fact that more than one publisher or account carried. Jev
 * read each story once at ingestion and is not asked about it again here;
 * the "is any of this worth interrupting for" question this used to ask on
 * every visit is gone. Then one Jev call picks among only the true lines,
 * with the held news spelled out as separate options.
 *
 * With no Jev answer, or a low-confidence one, the eligible list's own order
 * decides, so the line is always a true thing and never a guess.
 */

const VERSION = "nudge-2";
const NEWS_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Only posts Jev read as reporting a new fact or better qualify as news worth a line. */
const NEWS_FLOOR = substanceToWeight(3);
const MAX_NEWS_OPTIONS = 5;
const CONFIDENCE_FLOOR = 0.35;
/** A headline must be this surely about the listing to interrupt its owner (the column keeps one from 0.35). */
const ABOUT_FLOOR = 0.7;

/**
 * A ceiling on distinct uncached questions per instance per hour. The fact
 * space is already bounded (lib/nudge `parseFacts`); this is the belt to go
 * with those braces, so the credit cannot be drained whatever arrives.
 */
const ASKS_PER_HOUR = 300;
let windowStart = 0;
const askedThisHour = new Set<string>();
function withinBudget(key: string): boolean {
  const now = Date.now();
  if (now - windowStart > 60 * 60 * 1000) {
    windowStart = now;
    askedThisHour.clear();
  }
  if (askedThisHour.has(key)) return true;
  if (askedThisHour.size >= ASKS_PER_HOUR) return false;
  askedThisHour.add(key);
  return true;
}

/** What each standing line does, for Jev to choose between. Never the copy itself. */
const LINE_BRIEFS: Record<Exclude<NudgeKind, "heldNews">, string> = {
  addFunds: "Explain where to add dollars, because the account is empty",
  firstBuy: "Say their dollars have arrived and the board is where to buy, because they hold nothing yet",
  parkCash: "Mention that dollars waiting to be spent can sit in the Treasury bill fund until needed",
  invite: "Mention that they can now invite a friend",
};

function describe(facts: NudgeFacts): string[] {
  const names = facts.held
    .filter((symbol) => symbol !== CASH_SYMBOL)
    .map((symbol) => NAMES.get(symbol) ?? symbol);
  return [
    names.length > 0 ? `They own: ${names.join(", ")}.` : "They own no stocks or funds yet.",
    facts.funds
      ? "They have dollars in their account waiting to be spent."
      : "They have no spendable dollars in their account.",
    facts.held.includes(CASH_SYMBOL)
      ? "Some of their dollars are parked in the Treasury bill fund."
      : "None of their dollars are parked in the Treasury bill fund.",
    facts.canInvite ? "Their invite link is unlocked." : "Their invite link is still locked.",
  ];
}

/** Whether a stored story is worth a line to its owner: material, or a new fact carried by more than one. */
export function worthALine(card: StoryCard): boolean {
  if (card.substance === undefined || substanceToWeight(card.substance) < NEWS_FLOOR) return false;
  if (card.kind === "article" && (card.about ?? 0) < ABOUT_FLOOR) return false;
  if (card.verdict === "material") return true;
  return card.verdict === "fact" && card.alsoReportedBy.length + card.alsoOnX.length > 0;
}

export function heldNewsFor(facts: NudgeFacts, cards: readonly StoryCard[], now = Date.now()): StoryCard[] {
  const news: StoryCard[] = [];
  for (const card of cards) {
    if (now - card.publishedAt >= NEWS_WINDOW_MS) continue;
    // Each held listing the story is about, with that listing's own reading.
    for (const symbol of card.symbols) {
      if (symbol === CASH_SYMBOL || !facts.held.includes(symbol)) continue;
      const mine = forListing(card, symbol);
      if (mine && worthALine(mine)) {
        news.push(mine);
        break;
      }
    }
  }
  return news.sort((a, b) => (b.substance ?? 0) - (a.substance ?? 0) || b.publishedAt - a.publishedAt).slice(0, MAX_NEWS_OPTIONS);
}

function toNudge(kind: NudgeKind, card?: StoryCard): Nudge | null {
  if (kind !== "heldNews") return { kind };
  if (!card) return null;
  return { kind, symbol: card.symbol, name: card.name, postUrl: card.url };
}

export async function pickNudge(facts: NudgeFacts): Promise<Nudge | null> {
  const { cards } = await readCards({ sinceMs: Date.now() - NEWS_WINDOW_MS }).catch(() => ({ cards: [] as StoryCard[] }));
  const news = heldNewsFor(facts, cards);
  const kinds = eligibleKinds(facts, news.length > 0);
  if (kinds.length === 0) return null;

  const fallback = toNudge(kinds[0], news[0]);
  if (kinds.length === 1) return fallback;

  const options: Record<string, string> = {};
  const newsByOption = new Map<string, StoryCard>();
  for (const kind of kinds) {
    if (kind !== "heldNews") {
      options[kind] = LINE_BRIEFS[kind];
      continue;
    }
    news.forEach((card, index) => {
      const key = `news${index}`;
      newsByOption.set(key, card);
      options[key] = `Tell them there is news today about ${card.name}, which they own: \`news.${key}\``;
    });
  }

  const state = {
    person: describe(facts),
    news: Object.fromEntries([...newsByOption].map(([key, card]) => [key, `${card.name}: ${card.title}`])),
  };
  const questions: { line: ChoiceQuestion } = {
    line: {
      type: "choice",
      instructions:
        "This person has just opened their investing app. Which one of these would be the most useful single thing to tell them right now?",
      criteria: options,
    },
  };

  if (!withinBudget(fingerprint({ state, questions }))) return fallback;
  const answers = await cachedVerdict(VERSION, state, questions);
  if (!answers) return fallback;

  const ranked = Object.entries(answers.line.probabilities)
    .filter(([key]) => key in options)
    .sort((a, b) => b[1] - a[1]);
  const [chosen] = ranked[0] ?? [];
  // Unsure: the rules' own order.
  if (!chosen || answers.line.confidence < CONFIDENCE_FLOOR) return fallback;
  const card = newsByOption.get(chosen);
  return card ? toNudge("heldNews", card) : toNudge(chosen as NudgeKind);
}
