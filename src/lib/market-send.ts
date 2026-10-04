/**
 * A market order's send, the SDK's `leverageYield.vaultSwap` split open.
 * vaultSwap runs create, verify, relay and notify in one promise; its
 * notify is a retried fetch with no timeout, so a solver that never
 * answered left the order screen on its signing step for good (a refresh
 * then lost the order's record), and a solver that answered with an error
 * turned an order already on the hub into "failed".
 *
 * The steps up to the hub are vaultSwap's own, in its order, each run once
 * (`reachHub`): nothing here signs, broadcasts or relays a second time.
 * Once the hub transaction is known the order moves to its fill watch at
 * once, and the solver is told in the background: three tries with a
 * backoff, each bounded (`notifyWithRetries`), then again a few times
 * while the fill watch still reads NOT_FOUND (`renotifyDue`). Telling the
 * solver is a POST of the hub hash; it never sends the order again.
 */

/** How long the solver gets to answer the notify, its own retries included. */
export const SOLVER_NOTIFY_DEADLINE_MS = 20_000;

export type NotifyOutcome = { ok: true; intentHash?: string } | { ok: false; error: string };

/** `notify` within `ms`; no answer in time is `{ ok: false }`, never a throw. */
export async function notifyWithin(
  notify: () => Promise<NotifyOutcome>,
  ms: number = SOLVER_NOTIFY_DEADLINE_MS,
): Promise<NotifyOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<NotifyOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: `no answer from the solver within ${Math.round(ms / 1000)}s` }), ms);
  });
  const told = notify().catch((error: unknown): NotifyOutcome => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  try {
    return await Promise.race([told, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

export type ReachHubDeps<Intent> = {
  /** The signed and broadcast intent (the SDK's createVaultIntent), already awaited. */
  created: Result<{ tx: string; intent: Intent; relayData: unknown }>;
  verify: (tx: string) => Promise<Result<unknown>>;
  /** The hub tx hash, relayed once; undefined when the source is the hub itself. */
  relay: ((tx: string, relayData: unknown) => Promise<Result<{ dst_tx_hash: string }>>) | undefined;
  /** Maps a failure after broadcast as vaultSwap would (verifyFailed, mapRelayFailure). */
  mapVerifyError: (error: unknown) => unknown;
  mapRelayError: (error: unknown) => unknown;
};

export type ReachHubResult<Intent> =
  | { ok: false; error: unknown }
  | { ok: true; intent: Intent; spokeTxHash: string; hubTxHash: string };

/** vaultSwap's verify and relay, each once, for an intent already sent. */
export async function reachHub<Intent>(deps: ReachHubDeps<Intent>): Promise<ReachHubResult<Intent>> {
  const created = deps.created;
  if (!created.ok) return { ok: false, error: created.error };
  const { tx, intent, relayData } = created.value;
  const verified = await deps.verify(tx);
  if (!verified.ok) return { ok: false, error: deps.mapVerifyError(verified.error) };
  let hubTxHash = tx;
  if (deps.relay) {
    const packet = await deps.relay(tx, relayData);
    if (!packet.ok) return { ok: false, error: deps.mapRelayError(packet.error) };
    hubTxHash = packet.value.dst_tx_hash;
  }
  return { ok: true, intent, spokeTxHash: tx, hubTxHash };
}

/** How many times the solver is told before the order is left to its watch, as a slow order's (lib/slow-order). */
export const NOTIFY_ATTEMPTS = 3;

/**
 * Tells the solver up to NOTIFY_ATTEMPTS times, 2 s then 4 s apart, each
 * try bounded by SOLVER_NOTIFY_DEADLINE_MS. Never throws.
 */
export async function notifyWithRetries(
  notify: () => Promise<NotifyOutcome>,
  {
    attempts = NOTIFY_ATTEMPTS,
    deadlineMs = SOLVER_NOTIFY_DEADLINE_MS,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: { attempts?: number; deadlineMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<NotifyOutcome> {
  let told = await notifyWithin(notify, deadlineMs);
  for (let attempt = 1; !told.ok && attempt < attempts; attempt++) {
    await sleep(2_000 * attempt);
    told = await notifyWithin(notify, deadlineMs);
  }
  return told;
}

/** The solver's status for an intent it has not seen. */
export const STATUS_NOT_FOUND = -1;
/** How many more times the fill watch tells the solver, at most, after the first round. */
export const RENOTIFY_MAX = 3;
/** The least time between two of those. */
export const RENOTIFY_GAP_MS = 15_000;

export type RenotifyState = {
  hubTxHash: string;
  /** A notify is out now (the first round, or a re-notify). */
  busy: boolean;
  renotifies: number;
  /** When the last notify ended. */
  lastAt: number;
};

/** Whether the fill watch should tell the solver again: it still says NOT_FOUND, within the bounds. */
export function renotifyDue(statusCode: number | undefined, state: RenotifyState, now: number): boolean {
  return (
    statusCode === STATUS_NOT_FOUND &&
    !state.busy &&
    state.renotifies < RENOTIFY_MAX &&
    now - state.lastAt >= RENOTIFY_GAP_MS
  );
}

/**
 * Awaits `work` unless `stalled` comes first (a sponsored send past its
 * deadline, lib/gas-sponsor): then hands back `later`, the same work still
 * running, for the order to finish in the background.
 */
export async function unlessStalled<T>(
  work: Promise<T>,
  stalled: Promise<void>,
): Promise<{ stalled: false; value: T } | { stalled: true; later: Promise<T> }> {
  const first = await Promise.race([
    work.then((value) => ({ stalled: false as const, value })),
    stalled.then(() => ({ stalled: true as const, later: work })),
  ]);
  return first;
}
