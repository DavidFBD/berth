import { SolverIntentStatusCode } from "@sodax/sdk";

/**
 * The two waits of an order from a slow source chain (Bitcoin), as pure
 * loops over injected calls so their timing rules are testable without a
 * relayer, a solver or a clock. `useVaultAction` supplies the SDK calls.
 *
 * The SDK's own relay wait (`relayTxAndWaitPacket`) gives up on the first
 * relayer error that is not a 404 (RELAY_POLLING_FAILED): one 502, one 429,
 * one Safari tab resuming from the background ends a wait that is meant to
 * last an hour. These loops treat such errors as weather, not as an answer.
 */

/** What a relay helper answers: its packet, or an error whose message is a relay code. */
export type RelayCall<T> = Promise<{ ok: true; value: T } | { ok: false; error: unknown }>;

export type RelayDeps = {
  /** Hand the payment to the relayer. */
  submit: () => RelayCall<unknown>;
  /** Wait up to `windowMs` for the packet to execute on the hub. */
  poll: (windowMs: number) => RelayCall<{ dst_tx_hash: string }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export type RelayWaitOptions = {
  /** Total time the relay may take, from the first submit. */
  budgetMs: number;
  /**
   * Whether the payment already left the wallet on chain. A broadcast
   * payment is retried for the whole budget, since the relayer may be the
   * only party that can act on it. An unbroadcast payload (a Bitcoin
   * withdraw) that the relayer never accepts moved nothing, and gives up
   * after `submitAttempts` so the user can simply try again.
   */
  broadcast: boolean;
  submitAttempts?: number;
};

export type RelayOutcome =
  | { kind: "landed"; hubTxHash: string }
  /** The relayer never accepted an unbroadcast payload: nothing moved. */
  | { kind: "notAccepted"; relayError: string }
  /** The budget ran out before the packet landed. The payment may still arrive. */
  | { kind: "spent"; relayError: string };

/** How long a poll waits while the submit has not been accepted yet. */
const UNACCEPTED_POLL_MS = 5_000;
const BACKOFF_START_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

/**
 * The relay helpers fail with a bare `Error(code)`, the code being one of
 * RELAY_ERROR_CODES; anything else (a thrown fetch) reads as its message.
 */
export function relayCode(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : String(error);
}

export async function waitForRelay(
  deps: RelayDeps,
  { budgetMs, broadcast, submitAttempts = 3 }: RelayWaitOptions,
): Promise<RelayOutcome> {
  const deadline = deps.now() + budgetMs;
  let accepted = false;
  let submits = 0;
  /** The relayer's last word on the submit, and on the packet. */
  let submitError: string | undefined;
  let pollError: string | undefined;
  let backoff = BACKOFF_START_MS;

  const pause = async () => {
    const ms = Math.min(backoff, deadline - deps.now());
    if (ms > 0) await deps.sleep(ms);
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  };

  while (deps.now() < deadline) {
    if (!accepted) {
      const submitted = await deps.submit();
      submits += 1;
      if (submitted.ok) {
        accepted = true;
      } else {
        submitError = relayCode(submitted.error);
        if (!broadcast && submits >= submitAttempts) {
          return { kind: "notAccepted", relayError: submitError };
        }
      }
    }

    // Polled even after a failed submit: the relayer may have taken it and
    // failed to say so, or found the payment on chain itself.
    const remaining = deadline - deps.now();
    if (remaining <= 0) break;
    const window = accepted ? remaining : Math.min(remaining, UNACCEPTED_POLL_MS);
    const packet = await deps.poll(window);
    if (packet.ok) return { kind: "landed", hubTxHash: packet.value.dst_tx_hash };

    const code = relayCode(packet.error);
    pollError = code;
    if (code === "RELAY_TIMEOUT") {
      // The window passed quietly. With the submit accepted that window was
      // the rest of the budget; without it, try the submit again.
      if (accepted) break;
      await pause();
      continue;
    }
    // A relayer error, not an answer: back off and keep waiting.
    await pause();
  }

  if (!accepted && !broadcast) {
    return { kind: "notAccepted", relayError: submitError ?? "SUBMIT_TX_FAILED" };
  }
  return {
    kind: "spent",
    relayError: accepted
      ? (pollError ?? "RELAY_TIMEOUT")
      : (submitError ?? "SUBMIT_TX_FAILED"),
  };
}

/** One answer from the solver's status endpoint. */
export type FillStatus = {
  code?: number;
  fillTxHash?: string;
  /** Set when the endpoint could not answer. */
  error?: string;
};

export type FillDeps = {
  status: () => Promise<FillStatus>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Every answer, so an open screen can say registering or filling. */
  onStatus?: (status: FillStatus) => void;
  /**
   * Called once, when `releaseMs` passes without a terminal status: the
   * order becomes unsettled and the team is told. Watching goes on.
   */
  onRelease: (last: FillStatus) => void;
};

export type FillWatchOptions = {
  releaseMs: number;
  budgetMs: number;
  intervalMs: number;
  /** The slower interval once the order has been released. */
  lateIntervalMs: number;
};

export type FillOutcome =
  | { kind: "filled"; fillTxHash?: string; released: boolean }
  | { kind: "fillFailed"; fillTxHash?: string; released: boolean }
  | { kind: "gaveUp" };

/**
 * Watch the solver until it says filled or failed, releasing the order as
 * unsettled after `releaseMs` and giving up after `budgetMs`. A last known
 * status survives an erroring poll, so the release report says what the
 * solver last actually said.
 */
export async function watchFill(
  deps: FillDeps,
  { releaseMs, budgetMs, intervalMs, lateIntervalMs }: FillWatchOptions,
): Promise<FillOutcome> {
  const started = deps.now();
  let released = false;
  let last: FillStatus = {};
  while (deps.now() - started < budgetMs) {
    const answer = await deps.status();
    last = {
      code: answer.code ?? last.code,
      fillTxHash: answer.fillTxHash ?? last.fillTxHash,
      error: answer.error,
    };
    deps.onStatus?.(last);
    if (answer.code === SolverIntentStatusCode.SOLVED) {
      return { kind: "filled", fillTxHash: last.fillTxHash, released };
    }
    if (answer.code === SolverIntentStatusCode.FAILED) {
      return { kind: "fillFailed", fillTxHash: last.fillTxHash, released };
    }
    if (!released && deps.now() - started >= releaseMs) {
      released = true;
      deps.onRelease(last);
    }
    await deps.sleep(released ? lateIntervalMs : intervalMs);
  }
  if (!released) deps.onRelease(last);
  return { kind: "gaveUp" };
}

/** Everything that happens to a slow order after it left the wallet, in order. */
export type SlowOrderEvent =
  /** The relayer never took an unbroadcast payload: nothing moved. */
  | { type: "notAccepted"; relayError: string }
  /** The relay budget ran out after the payment left the wallet. */
  | { type: "stalled"; relayError: string; trackedMs: number }
  /** The intent reached the hub; `notifyError` if the solver could not be told. */
  | { type: "onHub"; hubTxHash: string; intentHash?: string; notifyError?: string }
  | { type: "status"; status: FillStatus }
  /** No terminal status inside the release wait: the order is unsettled. */
  | { type: "released"; last: FillStatus; trackedMs: number }
  | {
      type: "filled" | "fillFailed";
      fillTxHash?: string;
      /** Whether a `released` came first, so its report gets a follow-up. */
      released: boolean;
      trackedMs: number;
    }
  | { type: "gaveUp" };

export type SlowOrderDeps = {
  relay: () => Promise<RelayOutcome>;
  notify: (
    hubTxHash: string,
  ) => Promise<{ ok: true; intentHash?: string } | { ok: false; error: string }>;
  status: (hubTxHash: string) => Promise<FillStatus>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  emit: (event: SlowOrderEvent) => void;
};

/**
 * The life of a slow order after its payment left the wallet: relay, tell
 * the solver (three tries), watch the fill. Every event is emitted once, in
 * order, and nothing here knows whether a drawer is open: the caller files
 * reports and awards on the events unconditionally and mirrors them on
 * screen only while the screen still shows this order.
 */
export async function runSlowOrder(
  deps: SlowOrderDeps,
  fill: FillWatchOptions,
  notifyAttempts = 3,
): Promise<void> {
  const relayStarted = deps.now();
  const outcome = await deps.relay();
  if (outcome.kind === "notAccepted") {
    deps.emit({ type: "notAccepted", relayError: outcome.relayError });
    return;
  }
  if (outcome.kind === "spent") {
    deps.emit({
      type: "stalled",
      relayError: outcome.relayError,
      trackedMs: deps.now() - relayStarted,
    });
    return;
  }

  const hubTxHash = outcome.hubTxHash;
  let notified = await deps.notify(hubTxHash);
  for (let attempt = 1; !notified.ok && attempt < notifyAttempts; attempt++) {
    await deps.sleep(2_000 * attempt);
    notified = await deps.notify(hubTxHash);
  }
  deps.emit({
    type: "onHub",
    hubTxHash: outcome.hubTxHash,
    intentHash: notified.ok ? notified.intentHash : undefined,
    notifyError: notified.ok ? undefined : notified.error,
  });

  const watchStarted = deps.now();
  const ended = await watchFill(
    {
      status: () => deps.status(hubTxHash),
      sleep: deps.sleep,
      now: deps.now,
      onStatus: (status) => deps.emit({ type: "status", status }),
      onRelease: (last) =>
        deps.emit({ type: "released", last, trackedMs: deps.now() - watchStarted }),
    },
    fill,
  );
  if (ended.kind === "gaveUp") {
    deps.emit({ type: "gaveUp" });
    return;
  }
  deps.emit({
    type: ended.kind,
    fillTxHash: ended.fillTxHash,
    released: ended.released,
    trackedMs: deps.now() - watchStarted,
  });
}
