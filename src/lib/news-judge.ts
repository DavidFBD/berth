import type {
  ChoiceAnswer,
  ChoiceQuestion,
  NoulAnswer,
  NoulQuestion,
  ScoreAnswer,
  ScoreQuestion,
} from "@/lib/server/jev";
import { CAPITALS_ONLY_FORMS, STOCK_LISTINGS, listingNameForms } from "@/lib/listings";
import { namesListingInContext } from "@/lib/x-feed";

/**
 * What Jev is asked about a piece of news, and what its answers mean.
 *
 * Pure: no fetching, no cache, so the thresholds below can be tested against
 * answers written by hand. The asking lives in lib/server/jev.
 *
 * The keyword rules in lib/x-feed stay, and stay first. They are free and
 * they run whether or not Jev answers, so the column is never worse than it
 * was before Jev. What Jev adds is the reading those rules cannot do: whether
 * "Apple" is the company or the fruit, whether a wire is reporting a figure
 * or pitching a newsletter, and whether a post that names no listing at all
 * ("OPEC agrees a deeper cut") is still about one of ours (the oil fund).
 *
 * Bump `JUDGE_VERSION` whenever a question or rubric changes, or verdicts
 * cached against the old wording keep answering the old question.
 */
export const JUDGE_VERSION = "news-1";

/**
 * Who each listing is, in words a reader of the news would recognise. Jev
 * reads meanings, not tickers (its own docs: semantic beats symbolic), so a
 * fund is described by what moves it.
 */
export const LISTING_BRIEFS: Readonly<Record<string, string>> = {
  SPCX: "SpaceX, the rocket and Starlink satellite company, including Starship launches",
  NVDA: "NVIDIA, the maker of AI chips and graphics processors",
  AAPL: "Apple, the iPhone and Mac company (not the fruit)",
  TSLA: "Tesla, the electric car, battery and robotaxi company",
  GME: "GameStop, the video game retailer",
  MSTR: "Strategy (formerly MicroStrategy), the company that buys and holds bitcoin, led by Michael Saylor",
  MU: "Micron, the memory chip maker",
  SNDK: "Sandisk, the flash storage maker",
  SPY: "an S&P 500 index fund: news about the S&P 500 or the US stock market as a whole",
  QQQ: "a Nasdaq-100 index fund: news about the Nasdaq-100 or large US tech stocks as a group",
  SGOV: "a short-term US Treasury bill fund: news about T-bill yields, Fed rate decisions or short-term interest rates",
  USO: "an oil fund: news about crude oil prices, OPEC, Brent or WTI",
  SLV: "a silver fund: news about the price of silver",
  GOOGL: "Alphabet, the parent of Google, YouTube and Waymo",
  AMZN: "Amazon, the online retailer and AWS cloud company",
  MSFT: "Microsoft, the Windows, Office, Azure cloud and Xbox company",
  META: "Meta Platforms, the owner of Facebook, Instagram and WhatsApp",
  CRCL: "Circle Internet Group, the issuer of the USDC stablecoin",
  COIN: "Coinbase, the US crypto exchange",
  PLTR: "Palantir, the data analytics and defence software company",
  TSM: "TSMC (Taiwan Semiconductor Manufacturing), the contract chip maker",
  AMD: "AMD (Advanced Micro Devices), the maker of processors and AI chips",
  INTC: "Intel, the processor maker and chip foundry",
  BABA: "Alibaba, the Chinese e-commerce and cloud company",
  AMC: "AMC Entertainment, the movie theatre chain",
  HIMS: "Hims & Hers Health, the telehealth and wellness company",
  LLY: "Eli Lilly, the drug maker behind Zepbound and Mounjaro",
  COST: "Costco, the warehouse retailer",
  TTWO: "Take-Two Interactive, the video game publisher behind Grand Theft Auto",
  RBLX: "Roblox, the online games platform",
  IBM: "IBM, the enterprise software, hybrid cloud and quantum computing company",
  MRNA: "Moderna, the mRNA vaccine and drug developer",
  LULU: "Lululemon, the athletic apparel brand",
  SNAP: "Snap, the maker of Snapchat",
  WYFI: "WhiteFiber, the AI cloud and data centre infrastructure company",
  RIVN: "Rivian, the electric truck and van maker",
  NFLX: "Netflix, the streaming service",
  BULL: "Webull, the online brokerage",
  QUBT: "Quantum Computing Inc., the photonic quantum hardware company",
  NET: "Cloudflare, the internet security and network company",
  SKHY: "SK hynix, the South Korean memory chip maker",
  JNJ: "Johnson & Johnson, the pharmaceutical and medical device company",
  UPS: "UPS, the package delivery and logistics company",
  DJT: "Trump Media & Technology Group, the owner of Truth Social",
  RDDT: "Reddit, the online communities platform",
  GLD: "a gold fund: news about the price of gold",
};

export type Tier = "company" | "press";

const SUBSTANCE_LEVELS = [
  "Advertising, a promotion, an event invitation or a broadcast schedule",
  "A slogan, greeting, joke or opinion with no new information",
  "Commentary or analysis of facts that were already known",
  "Reports a new fact, figure or event",
  "Material news: earnings, guidance, a deal, a filing, regulation or a large price move",
];

export type PostQuestions = {
  listing: ChoiceQuestion;
  substance: ScoreQuestion;
  selling: NoulQuestion;
};

export type PostAnswers = {
  listing: ChoiceAnswer;
  substance: ScoreAnswer;
  selling: NoulAnswer;
};

/** State for one post: who said it and exactly what they said. */
export function postState(post: { author: { name: string; username: string }; text: string }) {
  return { author: `${post.author.name} (@${post.author.username})`, post: post.text };
}

export function postQuestions(): PostQuestions {
  return {
    listing: {
      type: "choice",
      instructions:
        "Which one of these companies or funds is `post` mainly about? Choose none if it only mentions one in passing.",
      criteria: {
        ...LISTING_BRIEFS,
        none: "None of them: the post is mainly about something else",
      },
    },
    substance: {
      type: "score",
      instructions:
        "How much new information does `post` give someone who owns the company or fund it is about?",
      criteria: SUBSTANCE_LEVELS,
    },
    selling: {
      type: "noul",
      instructions:
        "Is `post` advertising or selling something: a newsletter, a trading group or signal service, a course, a giveaway, an event, a broadcast, or a coin or penny stock being promoted?",
      criteria: {
        true: "It is advertising or promotion",
        false: "It is reporting or commenting, not selling",
      },
    },
  };
}

/**
 * The floors, per tier, because the tiers are trusted differently. A company
 * speaking for itself keeps anything that is not an ad or a bare slogan; the
 * wires must at least comment on something real.
 *
 * Measured on live posts 2026-09-22. At 2.0 the press tier keeps Reuters on a
 * record Nasdaq close (3.5) and Bloomberg on SpaceX joining the Nasdaq-100
 * (3.1), and drops CNBC's daily "biggest analyst calls" roundups (0.3 to 0.5),
 * "The Nvidia Dip: Are Investors Missing the Bigger Picture?" (1.0) and Maye
 * Musk on her son's press (1.8).
 *
 * There is deliberately no third tier of accounts we did not pick. It was
 * tried the same day: of 96 posts matching our names, two came from accounts
 * over 100k followers and both read as hot takes, while the rest included a
 * post about banks "colluding" to manipulate the market that Jev rated as
 * substantive news (3.0). Jev reads what a post says, not whether the person
 * saying it can be trusted. The author list is still the trust decision.
 */
const FLOORS: Record<Tier, { substance: number; selling: number; placement: number }> = {
  company: { substance: 0.9, selling: 0.6, placement: 0.35 },
  press: { substance: 2.0, selling: 0.5, placement: 0.45 },
};

export type PostVerdict =
  /** Keep, placed against `symbol`, with `weight` in place of the heuristic substance weight. */
  | { keep: true; symbol: string | undefined; weight: number }
  | { keep: false; why: string };

/**
 * What the answers mean for one post.
 *
 * `symbol` is Jev's placement when it is confident, otherwise undefined and
 * the caller keeps its keyword placement. `allowed` limits the placement: a
 * company account may only be placed among the listings it speaks for, so
 * @iShares is never filed under Tesla however it words a post.
 */
export function readPostAnswers(
  answers: PostAnswers,
  tier: Tier,
  allowed?: readonly string[],
): PostVerdict {
  const floor = FLOORS[tier];
  if (answers.selling.noul >= floor.selling) return { keep: false, why: "selling" };
  if (answers.substance.score < floor.substance) return { keep: false, why: "no substance" };

  const probabilities = answers.listing.probabilities;
  const none = probabilities.none ?? 0;
  let symbol: string | undefined;
  let best = 0;
  for (const [candidate, probability] of Object.entries(probabilities)) {
    if (candidate === "none") continue;
    if (allowed && !allowed.includes(candidate)) continue;
    if (probability > best) {
      best = probability;
      symbol = candidate;
    }
  }
  if (best < floor.placement) symbol = undefined;
  // A company's own account is about the company even when Jev hears a
  // general remark; only the tiers that had to earn their place are dropped
  // for being about nothing of ours.
  if (tier === "press" && !symbol && none >= 0.5) return { keep: false, why: "off topic" };

  return { keep: true, symbol, weight: substanceToWeight(answers.substance.score) };
}

/**
 * The rubric's 0 to 4 as a ranking multiplier, on the same scale as the
 * heuristic it replaces (0.55 for a slogan, 1.25 for a figure): a plain
 * report is 1.1, material news 1.6.
 */
export function substanceToWeight(score: number): number {
  const clamped = Math.min(Math.max(score, 0), 4);
  return Math.round((0.4 + clamped * 0.3) * 100) / 100;
}

/**
 * A ranking weight back to the reader's word for it. The weight is linear in
 * the rubric score (`substanceToWeight`), so this is the score's level,
 * rounded: 3.5 and over reads as material news, 2.5 and over as a new fact,
 * anything kept below that as analysis.
 */
export function verdictFor(weight: number): "material" | "fact" | "analysis" {
  const score = (weight - 0.4) / 0.3;
  if (score >= 3.5) return "material";
  if (score >= 2.5) return "fact";
  return "analysis";
}

/* — headlines — */

const HEADLINE_LEVELS = [
  "A list of stocks to buy, a stock-picking pitch, or a question like whether to buy",
  "An opinion or prediction with no new event behind it",
  "Analysis or a recap of facts that were already known",
  "Reports a new fact, figure or event",
  "Material news: earnings, guidance, a deal, a filing, regulation or a large price move",
];

export type HeadlineQuestions = { about: NoulQuestion; substance: ScoreQuestion };
export type HeadlineAnswers = { about: NoulAnswer; substance: ScoreAnswer };

export function headlineState(item: { title: string; source: string }, symbol: string, name: string) {
  return {
    headline: item.title,
    publisher: item.source,
    listing: LISTING_BRIEFS[symbol] ?? name,
  };
}

export function headlineQuestions(): HeadlineQuestions {
  return {
    about: {
      type: "noul",
      instructions:
        "Is `headline` mainly about `listing`, rather than mentioning it among others or in passing?",
    },
    substance: {
      type: "score",
      instructions:
        "How much new information does `headline` promise someone who owns `listing`?",
      criteria: HEADLINE_LEVELS,
    },
  };
}

/**
 * Measured 2026-09-22. Nasdaq's feeds are mostly The Motley Fool and Zacks,
 * and Jev scores their formats in a narrow band: "If You Invested $1000 in
 * Nvidia a Decade Ago" 2.1, "Rosenblatt Initiates Coverage of Sandisk" 2.3,
 * "Apple Launches New Products in Time for New CEO" 3.0. The floor sits just
 * above the what-if. A question about whether a headline is clickbait was
 * tried and dropped: it flagged Ryan Cohen's $26.4M insider buy (0.92)
 * because the headline ended "Is GME Now a Buy?".
 */
export function keepHeadline(answers: HeadlineAnswers, named = true): boolean {
  const aboutFloor = named ? HEADLINE_ABOUT_NAMED : HEADLINE_ABOUT_UNNAMED;
  return answers.about.noul >= aboutFloor && answers.substance.score >= 2.2;
}

/**
 * How sure Jev must be that a headline is about the listing it was filed
 * under. Nasdaq files a piece under every ticker it touches, and a company's
 * headline that never names the company is the usual stray: measured
 * 2026-09-30, "Is FLNC's Long-Term Agreement on Battery Supply a Game
 * Changer?" under Tesla read 0.37 and passed the old single floor, while a
 * real Tesla story that names only Musk ("Elon Musk Says Robotaxi Service
 * Will Reach 10 More Cities") reads 0.87. Funds are never named by the
 * market news that moves them, so they keep the lower floor.
 */
const HEADLINE_ABOUT_NAMED = 0.35;
const HEADLINE_ABOUT_UNNAMED = 0.7;
const FUND_SYMBOLS = new Set(["SPY", "QQQ", "SGOV", "USO", "SLV", "GLD"]);

/**
 * Whether a headline names the listing it was filed under: by any of its
 * words (x-feed topics), its bare ticker, or the company's own name as the
 * registry spells it ("Netflix beats estimates"), whole words only. A name
 * that is also an ordinary word counts only in its company forms.
 */
export function headlineNamesListing(title: string, symbol: string): boolean {
  if (FUND_SYMBOLS.has(symbol)) return true;
  if (namesListingInContext(title, symbol)) return true;
  if (new RegExp(`\\b${symbol}\\b`).test(title)) return true;
  const listing = STOCK_LISTINGS.find((candidate) => candidate.symbol === symbol);
  if (!listing) return false;
  return listingNameForms(listing).some((form) => {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, CAPITALS_ONLY_FORMS.has(form) ? "u" : "iu").test(title);
  });
}

/** Jev's reading of a kept headline in the reader's three words, as the posts carry it. */
export function headlineVerdict(answers: HeadlineAnswers): "material" | "fact" | "analysis" {
  return verdictFor(substanceToWeight(answers.substance.score));
}
