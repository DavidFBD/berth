import {
  MAX_ATTEMPTS_PER_SLOT,
  REFRESH_AFTER_MS,
  RETRY_AFTER_MS,
  STALE_CLAIM_MS,
  MAX_RESULTS,
  allowance,
  currentSlot,
  newerId,
  pickQueries,
  slotsLeftToday,
  usableSinceId,
  utcDay,
} from "@/lib/x-schedule";
import {
  budgetSpent,
  claimSlot,
  finishSlot,
  heldQueries,
  holdQueries,
  lastFetchedAt,
  prune,
  readQueryStates,
  recordQueryFailure,
  reserveBudget,
  saveQueryResult,
  settleBudget,
  slotState,
  type StoredTweet,
  type Tier,
} from "@/lib/server/x-store";

/**
 * The one place that goes to X for the column, under lib/x-schedule's
 * rules: at most one fetch per slot for everyone (plus one refresh from the
 * button), each query asking only for posts newer than its last
 * (`since_id`), and every request paid for out of the day's cap before it
 * is sent. Everything else reads lib/server/x-store.
 *
 * `search` is passed in so the rules can be tested against a real schema
 * without a network.
 */

export type XJob = { key: string; tier: Tier; query: string };

export type XSearch = (query: string, options: { sinceId?: string; maxResults: number }) => Promise<StoredTweet[]>;

export type RefreshOutcome = {
  /** Why nothing was fetched, or which queries were, for the log. */
  said: string;
  requests: number;
  posts: number;
  failures: string[];
};

/** Slots this instance has seen settled, so a settled slot costs no database read. */
const settledHere = new Set<string>();
/**
 * UTC days this instance has seen spend their cap, and at which cap, so the
 * rest of such a day costs every poll no database read either.
 */
const capReachedHere = new Map<string, number>();

/** After eight days a post is past any card (lib/x-feed MAX_AGE_MS is five). */
const KEEP_MS = 8 * 24 * 60 * 60 * 1000;

export async function refreshIfDue({
  now,
  jobs,
  search,
  cap,
  fresh = false,
}: {
  now: number;
  jobs: readonly XJob[];
  search: XSearch;
  cap: number;
  /** The column's refresh button: one extra fetch per slot, of one query. */
  fresh?: boolean;
}): Promise<RefreshOutcome> {
  const idle = (said: string): RefreshOutcome => ({ said, requests: 0, posts: 0, failures: [] });
  const slot = currentSlot(now);
  const claim = fresh ? `${slot.key}:refresh` : slot.key;
  const day = utcDay(now);
  const capReached = (): RefreshOutcome => {
    capReachedHere.set(day, cap);
    return idle(`day's cap of ${cap} reached`);
  };
  if (capReachedHere.get(day) === cap) return idle(`day's cap of ${cap} reached`);
  if (settledHere.has(claim)) return idle("slot already fetched");
  const attempts = { maxAttempts: MAX_ATTEMPTS_PER_SLOT, staleMs: STALE_CLAIM_MS, retryAfterMs: RETRY_AFTER_MS };
  const state = await slotState(claim, now, attempts);
  if (state === "done") settledHere.add(claim);
  if (state !== "open") return idle("slot already fetched");
  if (fresh) {
    const last = await lastFetchedAt();
    if (last !== undefined && now - last < REFRESH_AFTER_MS) return idle("fetched moments ago");
  }
  const allowed = allowance({ cap, spent: await budgetSpent(day), slotsLeft: slotsLeftToday(now) });
  // Below one request's worth only when the day's remainder is: nothing more fits today.
  if (allowed < MAX_RESULTS) return capReached();

  if (!(await claimSlot(claim, now, attempts))) {
    return idle("slot claimed elsewhere");
  }

  // From the claim on, the slot is always finished and the reservation
  // always settled, whatever throws: an unfinished claim would hold the
  // slot and a third of the day's budget until midnight.
  let reserved = 0;
  let posts = 0;
  let requests = 0;
  let ok = false;
  const failures: string[] = [];
  const spans: string[] = [];
  try {
    const [queryStates, held] = await Promise.all([readQueryStates(), heldQueries(claim, now, STALE_CLAIM_MS)]);
    const states = new Map(queryStates.map((state) => [state.key, state]));
    // A query another fetch is asking right now (the slot beside a refresh)
    // would come back twice, and count twice against the cap.
    const due = jobs.filter((job) => !held.has(job.key)).map((job) => {
      const state = states.get(job.key);
      // A changed query, or one whose newest post is past X's reach, starts again from the week's best.
      const same = state && state.query === job.query ? state : undefined;
      // Its last turn, answered or failed: a query that keeps failing waits like any other.
      const turns = [same?.fetchedAt, same?.failedAt].filter((turn): turn is number => turn !== undefined);
      return { job, fetchedAt: turns.length ? Math.max(...turns) : undefined, sinceId: usableSinceId(same?.sinceId, now) };
    });
    const picked = pickQueries(due, allowed, fresh ? 1 : jobs.length);
    if (picked.length === 0) {
      ok = true;
      return idle("nothing to ask");
    }
    await holdQueries(claim, picked.map(({ job }) => job.key));
    if (!(await reserveBudget(day, picked.length * MAX_RESULTS, cap))) {
      ok = true;
      return capReached();
    }
    reserved = picked.length * MAX_RESULTS;
    requests = picked.length;

    await Promise.all(
      picked.map(async ({ job, sinceId }) => {
        let tweets: StoredTweet[];
        try {
          tweets = await search(job.query, { sinceId, maxResults: MAX_RESULTS });
        } catch (error) {
          failures.push(error instanceof Error ? error.message : "X request failed");
          spans.push(`${job.key}:failed`);
          await recordQueryFailure(job.key, job.query, now).catch(() => undefined);
          return;
        }
        // Counted the moment X answers: it has billed them, whether or not they are kept.
        posts += tweets.length;
        spans.push(`${job.key}:${tweets.length}`);
        const newest = tweets.reduce<string | undefined>((best, tweet) => newerId(best, tweet.id), sinceId);
        await saveQueryResult({ key: job.key, query: job.query, tier: job.tier, tweets, sinceId: newest, fetchedAt: now });
      }),
    );
    ok = failures.length < picked.length;
  } finally {
    await settleSafely(day, { reserved, used: posts, requests });
    await finishSlot(claim, { ok, posts, requests }).catch((error) =>
      console.warn("[x-column] slot not finished", error instanceof Error ? error.message : error),
    );
  }
  if (ok) settledHere.add(claim);
  await prune(now - KEEP_MS).catch(() => undefined);

  const spent = await budgetSpent(day).catch(() => undefined);
  // One line per real call to X, so the bill can be read off the logs.
  console.info(
    `[x-column] X ${fresh ? "refresh" : "slot"} ${slot.key}: ${requests} requests, ${spans.join(" ")}, day ${spent ?? "?"}/${cap}`,
  );
  return { said: spans.join(" "), requests, posts, failures };
}

async function settleSafely(day: string, amounts: { reserved: number; used: number; requests: number }) {
  if (amounts.reserved === 0 && amounts.used === 0) return;
  await settleBudget(day, amounts).catch((error) =>
    console.warn("[x-column] budget not settled", error instanceof Error ? error.message : error),
  );
}

/** Test-only: forget which slots and days this instance saw settled. */
export function forgetSettledSlots(): void {
  settledHere.clear();
  capReachedHere.clear();
}
