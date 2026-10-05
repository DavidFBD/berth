/**
 * Whether a line of someone else's text is shaped like investment advice: a
 * rating, a price target, a forecast, a valuation call, a listicle, an
 * imperative, or someone's call relayed. The one gate that keeps such text
 * away from a Buy button (lib/first-look), for headlines and for the X post
 * behind a move line alike.
 *
 * Deliberately broad. Dropping a fair headline costs a quiet line; keeping
 * an advice shaped one beside Buy costs a recommendation. Jev is not this
 * gate: measured 2026-10-01 it scored "Should You Buy Nvidia Stock Before Its
 * Next Earnings Report?" 0.15 on an "is this advice?" question, and a news
 * judge reads analyst rating actions as material news.
 *
 * The corpus in advice-shaped.test.ts is the contract: every advice line
 * there must be dropped and every factual one kept. Add to it before
 * changing a pattern.
 */

/** Lower case, straight quotes and dashes, one space, so a pattern sees one spelling. */
export function normaliseForAdvice(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Ratings and analyst actions: the words themselves, wherever they stand. */
const RATING = [
  /\b(strong[ -])?(buy|sell|hold)[ -]rated\b/,
  /\brated\b/,
  /\bratings?\b/,
  /\b(strong buy|strong sell|strong hold|moderate buy|moderate sell)\b/,
  /\b(outperform|underperform|overweight|underweight|equal[ -]weight|market perform|sector perform|neutral)\b/,
  /\b(reiterat\w*|initiat\w*|maintain\w*|upgrad\w*|downgrad\w*|coverage)\b/,
  /\b(gets|given|earns|receives|assigns?|issues?|keeps?|reaffirms?|reaffirmed|places?|starts?|starting) (a |an |its )?(buy|sell|hold|strong buy)\b/,
  /\b(buy|sell|hold) (rating|call|recommendation|signal|alert|zone|point|case)\b/,
  /\b(at|to|with|from) (buy|sell|hold)\b/,
  /\bzacks rank\b/,
  /\b(analysts?|wall street|brokers?|bank|strategists?) (say|says|said|see|sees|think|thinks|like|likes|love|loves|recommend|recommends|bullish|bearish)\b/,
  /\b(bullish|bearish)\b/,
];

/** Price targets in any form. */
const TARGET = [
  /\bpts?\b/,
  /\btargets?\b/,
  /\bprice objectives?\b/,
  /\bobjective\b/,
  /\bfair value\b/,
  /\bintrinsic value\b/,
  /\b(raises?|lifts?|cuts?|lowers?|trims?|boosts?|hikes?|ups|bumps?|sets?|slashes?)\b.{0,40}\bto \$\d/,
  /\$\d[\d,.]*\s*(price|share price)?\s*(by|in) (20\d\d|\d+ years?|the end of)/,
];

/** Forecasts and valuation calls. */
const FORECAST = [
  /\b(upside|downside)\b/,
  /\b(could|will|may|might|can|set to|poised to|ready to|about to|primed to|likely to|expected to) (gain|rally|soar|surge|skyrocket|double|triple|explode|rocket|jump|climb|rise|run|crash|plunge|tank|collapse|sink|fall|drop|tumble|rebound|recover|go higher|go lower|beat|outpace|outperform|crush|make you)\b/,
  /\b(undervalued|overvalued|under-valued|over-valued|bargain|on sale|oversold|overbought|mispriced|cheap stock|cheap shares)\b/,
  /\b(looks?|is|are|still|too|dirt|seems?|stays?|remains?|getting|trades?|trading) (so |very |too |really |incredibly |ridiculously |still )?(cheap|expensive|pricey|rich)\b/,
  /\d+(\.\d+)?\s?% (upside|downside|gain|return|rally|potential)\b/,
  /\b(stock|share|price) (forecasts?|predictions?|projections?)\b|\bpredicts? (the |its )?(stock|shares|price)\b|\boutlook for (the |its )?(stock|shares)\b/,
  /\b(going to|gonna) \$?\d/,
  // A relayed prediction about worth or a milestone: "will be worth more than Apple", "will hit $1 trillion".
  /\bwill (be worth|hit|reach|double|triple|overtake|surpass|top|eclipse|dethrone)\b|\bworth more than\b/,
  /\bmulti-?baggers?\b|\b\d+-?baggers?\b|\b\d+x (your money|returns?|gains?)\b|\b(double|triple) your money\b/,
];

/** Listicles and the Fool, Zacks, Benzinga, Seeking Alpha formats. */
const LISTICLE = [
  /\b(\d+|two|three|four|five|six|seven|eight|nine|ten) (reasons?|stocks?|ways?|things?|picks?|shares|growth stocks?|dividend stocks?|ai stocks?|chip stocks?|tech stocks?|etfs?|funds?|companies)\b/,
  /\bbetter (buy|stock|investment|pick)\b/,
  /\b(top|best|worst|favorite|favourite) (stock|stocks|pick|picks|buy|buys|investment|investments|idea|ideas)\b/,
  /\bbest .{0,20}\bstocks?\b/,
  /\btime to\b/,
  /\bload(ing)? up\b/,
  /\bwhere will\b/,
  /\bhere'?s why\b|\bhere is why\b|\bthis is why\b|\bthat'?s why\b/,
  /\btoo late\b/,
  /\bmillionaires?\b|\bget rich\b|\bretire (early|rich)\b|\bset for life\b|\bgenerational wealth\b/,
  /\bno[ -]brainer\b|\bscreaming\b|\bonce[ -]in[ -]a\b|\bmagnificent\b|\bmonster\b|\bunstoppable\b|\bhand over fist\b|\bdon'?t miss\b|\bmust[ -]own\b|\bmust[ -]have\b|\bsleep well\b|\bforever stock\b|\bhold forever\b|\bbuy and hold\b/,
  /\bshould (you|i|investors|we)\b|\bwould (you|i)\b|\bcould (you|i)\b/,
  /\bwhat (investors|you) (need|should|must) to know\b|\bwhat to (do|expect|watch)\b|\bto watch\b|\bon (your|the) radar\b|\bwatch ?list\b/,
  /\bi'?m (buying|selling|holding|adding|loading)\b|\bi (bought|sold|just bought|just sold|own)\b|\bwhy i\b|\bmy (top|favorite|favourite|biggest)\b/,
  /\bif you (invested|had invested|put|bought)\b/,
  /\bin (your|a) (portfolio|ira|roth|401)\b/,
];

/** Imperatives: buy, sell, avoid, dump, grab, add, trim, own a thing, anywhere in the line. */
const IMPERATIVE = [
  /\b(buy|sell|avoid|dump|grab|ditch|snap up|scoop up|accumulate|stay away from|steer clear of|bet on|back up the truck)\b/,
  /\b(buying|selling|shorting|dumping|grabbing|accumulating) (opportunity|chance|now|today)\b/,
  /\bthe dip\b/,
];

/** Someone's call, relayed: "Cramer says buy", "Musk tells fans to buy". */
const RELAYED = [
  /\b(says?|said|tells?|told|urges?|urged|recommends?|recommended|advises?|advised|calls?|called|wants you|thinks you) .{0,30}\b(buy|sell|hold|own|avoid|load|back up)\b/,
];

/**
 * Added 2026-10-01 from the delta red team's misses: hype and "next X",
 * bull and bear cases, direction calls, valuation words, analyst actions in
 * other words, the Cramer formats, positions, trader talk on X, and the
 * Dutch and German words for buying, targets and ratings.
 */
const MORE = [
  /\b(is|be|the) next (amazon|nvidia|apple|tesla|microsoft|alphabet|google|meta|netflix|palantir|bitcoin|big thing|trillion)\b/,
  /\bgenerational\b|\bopportunit(y|ies)\b|\bstock for the (next|long)\b|\bwinners?\b|\bfor the long (run|haul|term)\b/,
  /\b(bull|bear)(ish)? case\b|\bsqueeze\b|\bto the moon\b|\bmooning\b|\bwagmi\b|\blfg\b|\bhodl\b|\bsend it\b|\bprinting\b|\bnot financial advice\b|\bnfa\b|\bdyor\b|\u{1F680}/u,
  /\bfrom here\b|\bheaded (higher|lower|for|to|up|down)\b|\bheading (higher|lower|for|to)\b|\broom to (run|grow)\b|\bfurther to (go|run|fall)\b|\bmore to (go|come|run)\b/,
  /\bexpect (a beat|a miss|big|gains?|more|upside)\b|\bearnings esp\b|\bpoints? to a (beat|miss)\b|\bpreview\b/,
  /\b(a gift|gift at|attractive|keeper|compelling|best value)\b/,
  /\b(nod|thumbs up|conviction list|focus list|best ideas|top ideas|picks list)\b/,
  /\b(likes|loves|hates|is backing|bets on|is betting on)\b/,
  /\b(cramer|mad money|lightning round)\b/,
  /\b(stick with|stay with|hang on to|hold on to|don'?t sell|don'?t trade|keep buying)\b|(^|[:.;,] )own\b/,
  /\b(my|largest|core|top|biggest|a) (position|holding)s?\b|\bposition in\b|\bopened a\b|\badded to my\b|\bto my\b.{0,20}\bposition\b/,
  /\bload(s|ed|ing)? (the boat|more|up)\b|\baccumulat\w*\b|\bbought (more|the)\b/,
  /\b(going|went|staying|get|got) (long|short)\b|\blong \$|\bshort(ing)? \$|\b(calls|puts)\b/,
  /\bbreak(s|ing)? ?out\b|\bbroke out\b|\bnext stop\b|\b\d+ next\b|\btrade of the\b/,
  /\b(koop|koopt|kopen|koopadvies|kaufen|kauft|kaufempfehlung|kursziel|koersdoel|kursziele|verkopen|verkaufen|aandeel|aktie|beleggers|anleger|comprar|acheter)\b/,
];

/** Any question: a headline that asks is rarely only reporting. */
const QUESTION = [/\?/];

export const ADVICE_PATTERNS: readonly RegExp[] = [
  ...QUESTION,
  ...RATING,
  ...TARGET,
  ...FORECAST,
  ...LISTICLE,
  ...IMPERATIVE,
  ...RELAYED,
  ...MORE,
];

/**
 * Corporate actions that use the same verbs, taken out before the patterns
 * read the line: a company agreeing to buy another, buying back its own
 * shares, selling a unit, holding a meeting, a market sell-off. Only these
 * exact shapes; anything else with "buy" in it is still dropped.
 */
const CORPORATE = [
  // Only a deal's own verbs: "plans", "moves" and "set to buy" are how a
  // person's call is relayed too ("Cramer plans to buy more"), so they stay in.
  /\b(agrees?|agreed|agreement|deal|offers?|offered|bids?|approval|approved|approves|cleared|clears|announces?|announced|completes?|completed|closes?|closed|nears?|in talks|wins? approval) to (buy|sell|acquire)\b(?! (more|into|now|the dip))/g,
  // The noun only, or "to buy back" with what is bought back: "Buy back into Nvidia" stays a call.
  /\b(share )?buybacks?\b|\bshare repurchases?\b|\bto buy back (\$|shares|stock|its|up to)/g,
  /\bto (sell|buy) (its|a|an|the|\w+'s) (stake|unit|division|business|assets?|operations|subsidiary|plant|factory|brand)\b/g,
  /\bto hold (its|an|a|the) (annual|shareholder|investor|special|earnings|event|meeting|vote|conference|call|talks)\b/g,
  /\bsell-?offs?\b/g,
];

export function adviceShaped(text: string): boolean {
  let line = normaliseForAdvice(text);
  for (const phrase of CORPORATE) line = line.replace(phrase, " ");
  return ADVICE_PATTERNS.some((pattern) => pattern.test(line));
}
