/**
 * One story, one card. The press list overlaps on purpose (three desks
 * carry the same squawk within a minute, a company and its chairman post
 * the same purchase), and until 2026-09-30 each copy took its own card: on
 * the morning this was built, five of the column's thirty-four posts
 * repeated a story already on it.
 *
 * Pure: code decides every pair it can, and only the pairs it cannot are
 * put to Jev (lib/server/story-groups), which reads meaning well. Two posts
 * are only ever compared when they are placed against the same listing and
 * were made within a day of each other.
 *
 * The lead of a group is its first report, so a card keeps its id (and the
 * reader's "New" mark keeps its meaning) as later copies arrive; it ranks
 * with the group's strongest substance, and the others are named under it.
 */

/** Two posts further apart than this are two stories, whatever they say. */
export const STORY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** At or above this overlap, code alone calls it the same story. */
export const SAME_OVERLAP = 0.7;
/** Below this, code alone calls it a different one; between, Jev is asked. */
export const ASK_OVERLAP = 0.35;

/** Words that carry no story: the glue, and the furniture of a wire post. */
const STOPWORDS = new Set(
  (
    "the a an and or of to in on for at by with from as is are was were be been has have had it its " +
    "this that these those will would can could may says said say new up down over after before into " +
    "than not no but about more most per via just now today breaking report reports reportedly according " +
    "bln billion mln million pct percent"
  ).split(" "),
);

/** The words of a post that could tell two stories apart, lowercased, once each. */
export function storyWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    // "$TSLA" and "TSLA" are one word; "30" and "$30" too.
    .replace(/[$#@]/g, " ")
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9.]+/)
    .map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
  return new Set(words);
}

/**
 * Overlap coefficient: shared words over the shorter post's words. A squawk
 * headline and the longer post that carries it score high, where a plain
 * Jaccard would punish the longer one for saying more.
 */
export function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  if (smaller.size < 3) return 0;
  let shared = 0;
  for (const word of smaller) if (larger.has(word)) shared += 1;
  return shared / smaller.size;
}

export type StoryPost = { id: string; symbol: string; publishedAt: number; text: string };

export type PairCall = "same" | "different" | "ask";

/** What code alone can say about two posts. */
export function pairCall(a: StoryPost, b: StoryPost, words?: Map<string, Set<string>>): PairCall {
  if (a.symbol !== b.symbol || !a.symbol) return "different";
  if (Math.abs(a.publishedAt - b.publishedAt) > STORY_WINDOW_MS) return "different";
  const wordsOf = (post: StoryPost) => words?.get(post.id) ?? storyWords(post.text);
  const score = overlap(wordsOf(a), wordsOf(b));
  if (score >= SAME_OVERLAP) return "same";
  if (score >= ASK_OVERLAP) return "ask";
  return "different";
}

/** Every pair code cannot settle, closest first, so a cap drops the least likely. */
export function pairsToAsk<T extends StoryPost>(posts: readonly T[]): [T, T][] {
  const words = new Map(posts.map((post) => [post.id, storyWords(post.text)]));
  const pairs: { pair: [T, T]; score: number }[] = [];
  for (let i = 0; i < posts.length; i += 1) {
    for (let j = i + 1; j < posts.length; j += 1) {
      if (pairCall(posts[i], posts[j], words) !== "ask") continue;
      pairs.push({
        pair: [posts[i], posts[j]],
        score: overlap(words.get(posts[i].id)!, words.get(posts[j].id)!),
      });
    }
  }
  return pairs.sort((x, y) => y.score - x.score).map(({ pair }) => pair);
}

/** A stable key for a pair, whichever way round it is asked. */
export function pairKey(a: { id: string }, b: { id: string }): string {
  return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}

export type StoryGroup<T> = { lead: T; others: T[] };

/**
 * The posts as stories. `judged` holds Jev's answer for the pairs code could
 * not settle, by `pairKey`; a pair with no answer stays two stories, so a
 * missing Jev never merges anything. Groups are joined transitively, which is
 * what "the same story" means, and each is led by its first report.
 */
export function groupStories<T extends StoryPost>(
  posts: readonly T[],
  judged: ReadonlyMap<string, boolean> = new Map(),
): StoryGroup<T>[] {
  const words = new Map(posts.map((post) => [post.id, storyWords(post.text)]));
  const parent = posts.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  for (let i = 0; i < posts.length; i += 1) {
    for (let j = i + 1; j < posts.length; j += 1) {
      const call = pairCall(posts[i], posts[j], words);
      const same = call === "same" || (call === "ask" && judged.get(pairKey(posts[i], posts[j])) === true);
      if (same) parent[root(j)] = root(i);
    }
  }
  const members = new Map<number, T[]>();
  posts.forEach((post, index) => {
    const key = root(index);
    members.set(key, [...(members.get(key) ?? []), post]);
  });
  return [...members.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.publishedAt - b.publishedAt || a.id.localeCompare(b.id));
    return { lead: sorted[0], others: sorted.slice(1) };
  });
}
