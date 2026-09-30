import { groupStories, pairKey, pairsToAsk } from "@/lib/story-groups";
import { cachedVerdict, jevConfigured, type NoulQuestion } from "@/lib/server/jev";
import type { XPost } from "@/lib/x-feed";

/**
 * The X column's posts as stories (lib/story-groups): the copies of one
 * story folded into its first report, which names the others.
 *
 * Code settles most pairs by their words. The few it cannot, placed against
 * the same listing within a day and sharing some words but not most, are put
 * to Jev as one Noul each. Measured 2026-09-30 on the live column: "Tesla
 * Secures $30 Billion in New Credit Facilities" beside "Tesla takes on $30
 * billion in credit" 0.92, the two readings of the White House AI document
 * 0.65, and two different Apple stories 0.02, the day's close beside the
 * morning's futures 0.19.
 *
 * Bounded twice: at most `MAX_ASKS` new pairs per gathering, closest first,
 * and every answer cached for two weeks by the pair's exact words. A pair
 * with no answer stays two cards, so no Jev only means what it meant before.
 */

const VERSION = "story-1";
const SAME_FLOOR = 0.6;
const MAX_ASKS = 16;

const QUESTION: { same: NoulQuestion } = {
  same: {
    type: "noul",
    instructions:
      "Do `first` and `second` report the same news event: the same announcement, deal, figure or statement, even if worded differently?",
    criteria: {
      true: "The same event, reported twice",
      false: "Different events, or one only comments on or follows from the other",
    },
  },
};

export async function foldStories(
  posts: readonly XPost[],
  substance: Map<string, number> | undefined,
): Promise<{ posts: XPost[]; substance: Map<string, number> | undefined; folded: number }> {
  const judged = new Map<string, boolean>();
  if (jevConfigured()) {
    const asks = pairsToAsk(posts).slice(0, MAX_ASKS);
    await Promise.all(
      asks.map(async ([a, b]) => {
        const [first, second] = a.id < b.id ? [a, b] : [b, a];
        const answers = await cachedVerdict(
          VERSION,
          { first: `${first.author.name}: ${first.text}`, second: `${second.author.name}: ${second.text}` },
          QUESTION,
        );
        if (answers) judged.set(pairKey(a, b), answers.same.noul >= SAME_FLOOR);
      }),
    );
  }

  const groups = groupStories(posts, judged);
  const weights = substance ? new Map(substance) : undefined;
  let folded = 0;
  const out = groups.map(({ lead, others }) => {
    if (others.length === 0) return lead;
    folded += others.length;
    // The story ranks with its strongest reading, whichever copy had it.
    if (weights) {
      const strongest = Math.max(...[lead, ...others].map((post) => weights.get(post.id) ?? 0));
      if (strongest > 0) weights.set(lead.id, strongest);
    }
    return {
      ...lead,
      alsoBy: others.map((post) => ({ name: post.author.name, username: post.author.username, url: post.url })),
    };
  });
  return { posts: out, substance: weights, folded };
}
