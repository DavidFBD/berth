/**
 * A bound on one network's read, so a slow network cannot hold the page.
 *
 * The funds sweep reads a dozen networks side by side and the home waited
 * for the slowest: on 2026-10-04 Polygon's public endpoint hung past viem's
 * ten second timeout, viem retried three times, React Query three more, and
 * the Funds row (with the account total above it) stayed a skeleton for 20
 * to 50 seconds while eleven networks had long answered. Past its deadline
 * a network is "still reading": unknown, never zero (lib/home-stage counts
 * it with the networks that could not be read), shown on its own line, and
 * read again in the background until it answers.
 */

/** The longest one network's balance read may hold the page. Every network measured answers within 1.4 s. */
export const CHAIN_READ_DEADLINE_MS = 6_000;

/** How soon a network past its deadline, or one that failed, is read again. */
export const SLOW_CHAIN_RETRY_MS = 15_000;

/** A read that did not answer within its deadline. It may still answer later. */
export class ReadDeadlineError extends Error {
  constructor(readonly label: string, readonly ms: number) {
    super(`${label} did not answer within ${ms} ms`);
    this.name = "ReadDeadlineError";
  }
}

/** The read, or a ReadDeadlineError once `ms` have passed without an answer. */
export function withDeadline<T>(read: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ReadDeadlineError(label, ms)), ms);
  });
  return Promise.race([read, deadline]).finally(() => clearTimeout(timer));
}

/**
 * React Query's retry rule for a bounded read: a quick failure (a 5xx, a
 * refused connection) is tried once more at once, a read past its deadline
 * is not (another full wait would hold the page again); both are read again
 * on SLOW_CHAIN_RETRY_MS in the background.
 */
export function retryBoundedRead(failures: number, error: unknown): boolean {
  return !(error instanceof ReadDeadlineError) && failures < 1;
}
