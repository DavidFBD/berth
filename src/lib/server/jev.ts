import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";

/**
 * The one door to TypeSafe's Jev, a model that answers typed questions and
 * never writes a word. That is exactly why it is allowed near this app: it can
 * judge a post, place it against a listing or pick a line from copy.ts, and it
 * cannot say anything in a voice other than ours.
 *
 * Official API only (api.typesafe.ai). A reseller at jevtypesafeai.com charges
 * ten times the price and is not TypeSafe; do not point this at it.
 *
 * Every caller must survive `undefined`. No key, no credit, a timeout and a
 * 529 all come back as nothing, and the caller falls back to the rules it had
 * before Jev existed. Jev makes the app better; its absence never breaks it.
 *
 * What it costs, because the credit is prepaid and small. Input tokens only,
 * $0.042 a million; a judged post is ~950 tokens with its questions and a
 * headline ~460, so a thousand judgements is about four cents (measured
 * 2026-09-30; this line said three hundredths of a cent, a hundred times
 * too little). There is no balance endpoint: an empty credit shows only as
 * `[jev] answered 4xx` and the gatherings' "unanswered" lines. The real guard is
 * `cachedVerdict`: a post's verdict is asked for once and kept for weeks, so a
 * refresh pays only for what is new since the last one.
 */

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
/** Most calls land in ~100ms; past this the reader is waiting on us. */
const TIMEOUT_MS = 6_000;
/** Well under the 1,200 a minute the account is allowed. */
const MAX_IN_FLIGHT = 12;

export type NoulQuestion = {
  type: "noul";
  instructions: string | object;
  criteria?: { true?: string; false?: string };
};
export type ChoiceQuestion = {
  type: "choice";
  instructions: string | object;
  criteria: Record<string, string | null>;
};
export type ScoreQuestion = {
  type: "score";
  instructions: string | object;
  criteria: string[];
};
export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type ScoreAnswer = {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

type AnswersFor<Q extends Record<string, JevQuestion | undefined>> = {
  [K in keyof Q]: NonNullable<Q[K]> extends NoulQuestion
    ? NoulAnswer
    : NonNullable<Q[K]> extends ChoiceQuestion
      ? ChoiceAnswer
      : ScoreAnswer;
};

export function jevConfigured(): boolean {
  return Boolean(process.env.JEV_API_KEY) && process.env.JEV_DISABLED !== "1";
}

/**
 * A scope in which Jev is never asked: `cachedVerdict` answers only what an
 * earlier ask already put in the cache, and a miss is nothing (not cached,
 * so the gathering that owns the question still asks it later). For a read
 * that rides on verdicts other surfaces paid for, such as the first look
 * (lib/server/first-look), so its traffic can never become Jev traffic.
 */
const cachedOnly = new AsyncLocalStorage<true>();

export function withCachedVerdictsOnly<T>(work: () => Promise<T>): Promise<T> {
  return cachedOnly.run(true, work);
}

export function cachedVerdictsOnly(): boolean {
  return cachedOnly.getStore() === true;
}

/** A small semaphore, so a feed of four hundred posts is not four hundred sockets. */
let inFlight = 0;
const waiting: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  inFlight += 1;
  try {
    return await work();
  } finally {
    inFlight -= 1;
    waiting.shift()?.();
  }
}

/**
 * One evaluation. Retries once on 429 and 529, which the API asks for; every
 * other failure is logged and returned as nothing.
 */
export async function askJev<Q extends Record<string, JevQuestion | undefined>>(
  state: unknown,
  questions: Q,
): Promise<AnswersFor<Q> | undefined> {
  if (!jevConfigured() || cachedVerdictsOnly()) return undefined;
  const key = process.env.JEV_API_KEY as string;

  return slot(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ model: MODEL, state, questions }),
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if ((response.status === 429 || response.status === 529) && attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 400));
          continue;
        }
        if (!response.ok) {
          const said = await response.text().catch(() => "");
          console.warn(`[jev] answered ${response.status}`, said.slice(0, 200));
          return undefined;
        }
        const payload = (await response.json()) as { answers?: AnswersFor<Q> };
        return payload.answers;
      } catch (error) {
        console.warn("[jev] request failed", error instanceof Error ? error.message : error);
        return undefined;
      }
    }
    return undefined;
  });
}

/** Stable short hash of anything JSON can carry, for cache keys. */
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

/** Two weeks. A verdict on a post does not change; the post ages out long before. */
const VERDICT_SECONDS = 14 * 24 * 60 * 60;

/**
 * `askJev`, remembered across requests and instances in Next's data cache.
 *
 * `version` belongs to the questions: change a rubric and bump it, or every
 * old verdict keeps answering the old question. A failed ask is NOT cached,
 * because `unstable_cache` would keep the undefined for two weeks; it throws
 * instead and the next refresh tries again.
 */
export async function cachedVerdict<Q extends Record<string, JevQuestion | undefined>>(
  version: string,
  state: unknown,
  questions: Q,
): Promise<AnswersFor<Q> | undefined> {
  if (!jevConfigured()) return undefined;
  const key = fingerprint({ state, questions });
  try {
    return await unstable_cache(
      async () => {
        const answers = await askJev(state, questions);
        if (!answers) throw new Error("jev unavailable");
        return answers;
      },
      ["jev", version, key],
      { revalidate: VERDICT_SECONDS },
    )();
  } catch {
    return undefined;
  }
}
