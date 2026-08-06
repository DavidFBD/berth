/**
 * "Earned so far" bookkeeping.
 *
 * An ERC-4626 vault mints shares and forgets what they cost. Your share count
 * never changes; `previewRedeem` on one share creeps up as the vault accrues.
 * So the gain on held shares is exactly:
 *
 *     earned = shares × (pricePerShare_now − pricePerShare_when_acquired)
 *
 * The first two terms are readable on chain. The third is not stored anywhere,
 * by anyone — so we anchor it ourselves, from observation, and persist it.
 *
 * Anchoring in price-per-share rather than dollars is deliberate: it lives in
 * the vault's own accounting, so it is immune to the underlying's USD price
 * moving, and a partial pour-back cannot corrupt it (redeeming shares at
 * today's price leaves the remaining shares' basis untouched).
 */

const STORAGE_KEY = "lsteatime.earned.v1";

/** 1e18 — both share balances and price-per-share are 18-decimal. */
const WAD = 10n ** 18n;

/** Persisted anchor for one vault. bigints are stored as decimal strings. */
export type EarnedAnchor = {
  /** Share balance at the last observation. */
  shares: string;
  /** Share-weighted price-per-share the held shares were acquired at. */
  anchorPps: string;
  /**
   * Which holder set this anchor describes — a mismatch means a different
   * user (or a newly connected wallet family), so the anchor is discarded
   * rather than misapplied to someone else's shares.
   */
  owner: string;
  /**
   * True when every share was observed arriving from a zero balance, making
   * this a true lifetime basis. False when we first met an already-funded
   * position, whose real entry price is unknowable — then the figure is only
   * growth since `since`, and must be labelled as such.
   */
  exact: boolean;
  /** ISO timestamp the count began. */
  since: string;
};

type AnchorStore = Record<string, EarnedAnchor>;

function readStore(): AnchorStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as AnchorStore) : {};
  } catch {
    // Private-mode denial or hand-edited junk: fall back to counting afresh.
    return {};
  }
}

export function readAnchor(vault: string): EarnedAnchor | undefined {
  return readStore()[vault.toLowerCase()];
}

/** Subscribers for `useSyncExternalStore` — storage is the source of truth. */
const listeners = new Set<() => void>();

export function subscribeAnchors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Serialized anchor for one vault, or "" when there is none. Returned as a
 * string so repeated reads of unchanged storage compare equal by value, which
 * is what `useSyncExternalStore` needs to avoid spinning.
 */
export function anchorSnapshot(vault: string): string {
  const anchor = readStore()[vault.toLowerCase()];
  return anchor ? JSON.stringify(anchor) : "";
}

export function writeAnchor(vault: string, anchor: EarnedAnchor): void {
  if (typeof window === "undefined") return;
  try {
    const store = readStore();
    store[vault.toLowerCase()] = anchor;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked — the figure degrades to this session only.
  }
  // Notify even if the write failed: in-memory callers still want the read.
  for (const listener of listeners) listener();
}

/**
 * Fold one fresh reading into the anchor. Pure, so the share-weighting is
 * testable without touching storage.
 */
export function nextAnchor(
  prev: EarnedAnchor | undefined,
  reading: { shares: bigint; pps: bigint; owner: string; now: string },
): EarnedAnchor {
  const { shares, pps, owner, now } = reading;

  // First sighting, or a different holder set. Shares already sitting here
  // have an entry price we cannot know, so anchor at today: the count starts
  // from zero and is only exact if there was nothing to miss.
  if (!prev || prev.owner !== owner) {
    return {
      shares: shares.toString(),
      anchorPps: pps.toString(),
      owner,
      exact: shares === 0n,
      since: now,
    };
  }

  const prevShares = BigInt(prev.shares);

  if (shares > prevShares) {
    // Newly minted shares join the basis at today's price, share-weighted
    // against what was already held.
    const added = shares - prevShares;
    const anchorPps =
      (prevShares * BigInt(prev.anchorPps) + added * pps) / shares;
    return { ...prev, shares: shares.toString(), anchorPps: anchorPps.toString() };
  }

  // Redemption, or no movement: the shares that remain keep their basis.
  return { ...prev, shares: shares.toString() };
}

/** Gain on the held shares, in underlying units (18dp). Can be negative. */
export function earnedUnderlying(
  anchor: EarnedAnchor,
  shares: bigint,
  pps: bigint,
): bigint {
  return (shares * (pps - BigInt(anchor.anchorPps))) / WAD;
}

export function sameAnchor(a: EarnedAnchor, b: EarnedAnchor): boolean {
  return (
    a.shares === b.shares &&
    a.anchorPps === b.anchorPps &&
    a.owner === b.owner &&
    a.exact === b.exact &&
    a.since === b.since
  );
}
