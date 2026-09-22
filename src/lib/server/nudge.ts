import { substanceToWeight } from "@/lib/news-judge";
import { CASH_SYMBOL, eligibleKinds, type Nudge, type NudgeFacts, type NudgeKind } from "@/lib/nudge";
import { cachedVerdict, fingerprint, type ChoiceQuestion, type NoulQuestion } from "@/lib/server/jev";
import { NAME_BY_SYMBOL, gatherPosts } from "@/lib/server/x-column";
import type { XPost } from "@/lib/x-feed";

/**
 * Which one line to say, for one account, right now.
 *
 * Code first: `eligibleKinds` decides what is true of the account. Then one
 * Jev call picks among only those, with the news about held listings spelled
 * out as separate options, and a Noul asks whether any of that news is worth
 * interrupting someone for at all. A holder of NVIDIA is told about "Huang:
 * NVIDIA to sell twice as many chips next year" and not about a desk noting
 * the stock is up half a percent, which is the judgement the rules alone
 * cannot make.
 *
 * With no Jev answer, or a low-confidence one, the eligible list's own order
 * decides, so the line is always a true thing and never a guess.
 */

const VERSION = "nudge-1";
const NEWS_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Only posts Jev read as reporting a new fact or better qualify as news worth a line. */
const NEWS_FLOOR = substanceToWeight(3);
const MAX_NEWS_OPTIONS = 5;
const CONFIDENCE_FLOOR = 0.35;
const NEWS_WORTH_FLOOR = 0.5;

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
    .map((symbol) => NAME_BY_SYMBOL.get(symbol) ?? symbol);
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

function heldNewsFor(
  facts: NudgeFacts,
  posts: readonly XPost[],
  substance: ReadonlyMap<string, number> | undefined,
): XPost[] {
  if (!substance) return [];
  const now = Date.now();
  return posts
    .filter(
      (post) =>
        post.symbol !== CASH_SYMBOL &&
        facts.held.includes(post.symbol) &&
        now - post.publishedAt < NEWS_WINDOW_MS &&
        (substance.get(post.id) ?? 0) >= NEWS_FLOOR,
    )
    .sort(
      (a, b) =>
        (substance.get(b.id) ?? 0) - (substance.get(a.id) ?? 0) ||
        b.publishedAt - a.publishedAt,
    )
    .slice(0, MAX_NEWS_OPTIONS);
}

function toNudge(kind: NudgeKind, post?: XPost): Nudge | null {
  if (kind !== "heldNews") return { kind };
  if (!post) return null;
  return { kind, symbol: post.symbol, name: post.name, postUrl: post.url };
}

export async function pickNudge(facts: NudgeFacts): Promise<Nudge | null> {
  const { posts, substance } = await gatherPosts();
  const news = heldNewsFor(facts, posts, substance);
  const kinds = eligibleKinds(facts, news.length > 0);
  if (kinds.length === 0) return null;

  const fallback = toNudge(kinds[0], news[0]);
  if (kinds.length === 1 && kinds[0] !== "heldNews") return fallback;

  const options: Record<string, string> = {};
  const newsByOption = new Map<string, XPost>();
  for (const kind of kinds) {
    if (kind !== "heldNews") {
      options[kind] = LINE_BRIEFS[kind];
      continue;
    }
    news.forEach((post, index) => {
      const key = `news${index}`;
      newsByOption.set(key, post);
      options[key] = `Tell them there is news today about ${post.name}, which they own: \`news.${key}\``;
    });
  }

  const state = {
    person: describe(facts),
    news: Object.fromEntries(
      [...newsByOption].map(([key, post]) => [key, `${post.name}: ${post.text}`]),
    ),
  };
  const questions: { line: ChoiceQuestion; worth?: NoulQuestion } = {
    line: {
      type: "choice",
      instructions:
        "This person has just opened their investing app. Which one of these would be the most useful single thing to tell them right now?",
      criteria: options,
    },
  };
  if (newsByOption.size > 0) {
    questions.worth = {
      type: "noul",
      instructions:
        "Is any item in `news` important enough that someone who owns that company or fund would want to be told about it as soon as they open the app, rather than finding it later?",
      criteria: {
        true: "Material to an owner: earnings, guidance, a deal, a filing, regulation, a large move",
        false: "Routine: a small move, commentary, or something that can wait",
      },
    };
  }

  if (!withinBudget(fingerprint({ state, questions }))) return fallback;
  const answers = await cachedVerdict(VERSION, state, questions);
  if (!answers) return fallback;

  const worth = answers.worth?.noul ?? 0;
  const ranked = Object.entries(answers.line.probabilities)
    .filter(([key]) => key in options)
    .filter(([key]) => !newsByOption.has(key) || worth >= NEWS_WORTH_FLOOR)
    .sort((a, b) => b[1] - a[1]);
  const [chosen] = ranked[0] ?? [];
  if (!chosen || answers.line.confidence < CONFIDENCE_FLOOR) {
    // Unsure: the rules' own order, minus news Jev judged not worth saying.
    const safe = kinds.find((kind) => kind !== "heldNews" || worth >= NEWS_WORTH_FLOOR);
    return safe ? toNudge(safe, news[0]) : null;
  }
  const post = newsByOption.get(chosen);
  return post ? toNudge("heldNews", post) : toNudge(chosen as NudgeKind);
}
