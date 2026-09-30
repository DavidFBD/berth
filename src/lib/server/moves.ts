import { LISTING_BRIEFS, substanceToWeight } from "@/lib/news-judge";
import { candidatePosts, isNotableMove, moveWords, newsWindow } from "@/lib/moves";
import { cachedVerdict, type ChoiceQuestion } from "@/lib/server/jev";
import { loadPerformance } from "@/lib/server/listing-performance";
import { gatherPosts, type GatheredPosts } from "@/lib/server/x-column";
import type { XPost } from "@/lib/x-feed";

/**
 * For each listing whose last move was large for it, the one judged post
 * from around that day that Jev reads as related to the move, if any.
 *
 * One Choice per notable move, over at most five posts plus "none", asked
 * in words rather than numbers ("NVIDIA fell sharply"), because Jev reads
 * meaning well and figures poorly. Accepted only when the chosen post is
 * clearly ahead: a probability of one half and a confidence above the floor.
 * Anything less says nothing, which is the common and correct answer on a
 * day the market simply moved.
 *
 * Costs almost nothing: a handful of listings move enough on a given day,
 * and each question is cached for two weeks by its exact wording and posts.
 */

const VERSION = "moves-1";
/** Only posts Jev read as a new fact or better are offered. */
const CANDIDATE_FLOOR = substanceToWeight(2.5);
const PICK_PROBABILITY = 0.5;
const PICK_CONFIDENCE = 0.4;

export type MoveNews = {
  symbol: string;
  changePct: number;
  /** The mark the move ends on, ISO date. */
  asOf: string;
  /** `text` is the post verbatim, for the Assistant to quote; the board shows only who. */
  post: { url: string; name: string; username: string; publishedAt: number; text: string };
};

export type MovesResponse = { moves: MoveNews[] };

/** `inputs` reuses a performance read and an X gathering the caller already has (get_listing). */
export async function loadMoves(
  inputs: { performance?: ReturnType<typeof loadPerformance>; feed?: Promise<GatheredPosts> } = {},
): Promise<MovesResponse> {
  const [performance, feed] = await Promise.all([inputs.performance ?? loadPerformance(), inputs.feed ?? gatherPosts()]);
  if (!feed.substance) return { moves: [] };

  const moves: MoveNews[] = [];
  await Promise.all(
    Object.entries(performance.performance).map(async ([symbol, entry]) => {
      const series = entry.series ?? [];
      const dates = entry.seriesDates ?? [];
      const asOf = dates[dates.length - 1];
      if (!asOf || !isNotableMove(series, entry.changePct)) return;

      const posts = candidatePosts(feed.posts, feed.substance!, symbol, newsWindow(asOf), CANDIDATE_FLOOR);
      if (posts.length === 0) return;

      const byKey = new Map<string, XPost>(posts.map((post, index) => [`post${index}`, post]));
      const name = LISTING_BRIEFS[symbol] ?? symbol;
      const question: ChoiceQuestion = {
        type: "choice",
        instructions: {
          listing: name,
          move: `Its price ${moveWords(entry.changePct!)} over the last trading day.`,
          question:
            "Which one of these posts reports news that is directly about `listing` and could plausibly be related to `move`? Choose none if none of them is.",
        },
        criteria: {
          ...Object.fromEntries([...byKey].map(([key]) => [key, `The post \`posts.${key}\``])),
          none: "None of the posts is related to the move",
        },
      };
      const state = {
        posts: Object.fromEntries(
          [...byKey].map(([key, post]) => [key, `${post.author.name}: ${post.text}`]),
        ),
      };
      const answers = await cachedVerdict(VERSION, state, { related: question });
      const answer = answers?.related;
      if (!answer || answer.choice === "none") return;
      const probability = answer.probabilities[answer.choice] ?? 0;
      if (probability < PICK_PROBABILITY || answer.confidence < PICK_CONFIDENCE) return;
      const post = byKey.get(answer.choice);
      if (!post) return;
      moves.push({
        symbol,
        changePct: entry.changePct!,
        asOf,
        post: {
          url: post.url,
          name: post.author.name,
          username: post.author.username,
          publishedAt: post.publishedAt,
          text: post.text,
        },
      });
    }),
  );
  return { moves: moves.sort((a, b) => a.symbol.localeCompare(b.symbol)) };
}
