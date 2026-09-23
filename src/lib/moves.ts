/**
 * "What was in the news when it moved": which moves are worth a line, and
 * which posts may be offered as the news around one. Pure, so both rules can
 * be tested without a feed or a model.
 *
 * Code decides every number. A move qualifies only when it is large for
 * that listing: twice its own typical day, and at least a whole percent, so
 * a Treasury bill fund's quiet drift and a meme stock's ordinary Tuesday are
 * both left alone. Jev is then asked one thing only, which of the listing's
 * substantive posts from around that day is related to it (lib/server/moves),
 * and it may answer none.
 *
 * The line it feeds says "in the news", never "because". A post published
 * the day a price moved is not proof that it moved the price, and Berth does
 * not claim to know why a market did anything.
 */

/** Past this many marks the typical day is measured; about three months. */
const TYPICAL_WINDOW = 60;
/** A move must be this many typical days large to be worth a line. */
const TYPICAL_MULTIPLE = 2;
/** And at least this large in percent, whatever the listing's habits. */
const FLOOR_PCT = 1;

/** The median size of a day's move over the recent marks, in percent. */
export function typicalMovePct(series: readonly number[]): number | undefined {
  const recent = series.slice(-TYPICAL_WINDOW - 1);
  const moves: number[] = [];
  for (let index = 1; index < recent.length; index += 1) {
    const before = recent[index - 1];
    if (before > 0) moves.push(Math.abs((recent[index] / before - 1) * 100));
  }
  if (moves.length < 10) return undefined;
  moves.sort((a, b) => a - b);
  const middle = Math.floor(moves.length / 2);
  return moves.length % 2 === 0 ? (moves[middle - 1] + moves[middle]) / 2 : moves[middle];
}

/** Whether the last move is large for this listing. */
export function isNotableMove(series: readonly number[], changePct: number | undefined): boolean {
  if (changePct === undefined || !Number.isFinite(changePct)) return false;
  const typical = typicalMovePct(series.slice(0, -1));
  if (typical === undefined) return false;
  const size = Math.abs(changePct);
  return size >= FLOOR_PCT && size >= typical * TYPICAL_MULTIPLE;
}

/**
 * The window a post must fall in to be offered: from a day and a half before
 * the latest mark, which covers the session that mark closes, until now.
 * Marks are stamped around 12:50 UTC.
 */
export function newsWindow(latestMarkDate: string): { from: number; to: number } {
  const mark = Date.parse(`${latestMarkDate}T12:50:00Z`);
  return { from: mark - 36 * 60 * 60 * 1000, to: Number.POSITIVE_INFINITY };
}

/** At most this many posts are offered; the model reads better from few. */
export const MAX_CANDIDATES = 5;

/**
 * The listing's own posts inside the window that Jev already read as
 * reporting a new fact or better, most substantive first.
 */
export function candidatePosts<T extends { id: string; symbol: string; publishedAt: number }>(
  posts: readonly T[],
  substance: ReadonlyMap<string, number>,
  symbol: string,
  window: { from: number; to: number },
  floorWeight: number,
): T[] {
  return posts
    .filter(
      (post) =>
        post.symbol === symbol &&
        post.publishedAt >= window.from &&
        post.publishedAt <= window.to &&
        (substance.get(post.id) ?? 0) >= floorWeight,
    )
    .sort(
      (a, b) =>
        (substance.get(b.id) ?? 0) - (substance.get(a.id) ?? 0) || b.publishedAt - a.publishedAt,
    )
    .slice(0, MAX_CANDIDATES);
}

/** A move in words Jev reads well: it is poor at numbers, good at meaning. */
export function moveWords(changePct: number): string {
  const size = Math.abs(changePct);
  const how = size >= 5 ? "sharply" : "noticeably";
  return changePct > 0 ? `rose ${how}` : `fell ${how}`;
}
