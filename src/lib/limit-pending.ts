/**
 * Limit orders the page placed but could not yet save (hooks/use-limit-orders):
 * kept in this browser until Berth has a record, so an order resting on
 * chain is never forgotten because a request failed. The server's sweep
 * (lib/server/limit-orders sweepMissing) is the other half of the net.
 *
 * Storage is passed in and every access is wrapped: a private window or
 * blocked storage simply keeps nothing, and the sweep still finds it.
 */

export type PendingLimit = {
  /** The payment's transaction on its own chain. */
  spokeTxHash: string;
  /** The intent's hub transaction, once known; what the record call needs. */
  intentTxHash?: string;
  direction: "buy" | "sell";
  limitPrice: string;
  intentHash?: string;
  srcChain: string;
  /** When it was placed, epoch ms. */
  at: number;
};

export const PENDING_KEY = "berth.limit-pending";
/** Past this the entry is dropped: the evening sweep has had its chance many times over. */
export const PENDING_KEEP_MS = 3 * 86_400_000;
/**
 * An entry that never learned its hub transaction goes after an hour: the
 * payment either reached the hub by then, and the sweep has recorded it,
 * or it did not, and there is nothing to record.
 */
export const PENDING_NO_HUB_KEEP_MS = 60 * 60_000;

type Store = Pick<Storage, "getItem" | "setItem">;

function store(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readPending(from: Store | null = store(), now = Date.now()): PendingLimit[] {
  try {
    const raw = from?.getItem(PENDING_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PendingLimit =>
        !!entry &&
        typeof entry.spokeTxHash === "string" &&
        (entry.direction === "buy" || entry.direction === "sell") &&
        typeof entry.at === "number" &&
        now - entry.at < (typeof entry.intentTxHash === "string" ? PENDING_KEEP_MS : PENDING_NO_HUB_KEEP_MS),
    );
  } catch {
    return [];
  }
}

function write(entries: PendingLimit[], to: Store | null): void {
  try {
    to?.setItem(PENDING_KEY, JSON.stringify(entries));
  } catch {
    // nothing kept; the sweep still finds it
  }
}

/** Add or update an entry, keyed by its spoke transaction. */
export function addPending(entry: PendingLimit, to: Store | null = store()): void {
  const rest = readPending(to).filter((existing) => existing.spokeTxHash !== entry.spokeTxHash);
  write([...rest, entry], to);
}

/** Drop an entry once Berth holds its record. */
export function removePending(spokeTxHash: string, to: Store | null = store()): void {
  write(
    readPending(to).filter((existing) => existing.spokeTxHash !== spokeTxHash),
    to,
  );
}
