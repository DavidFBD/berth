/**
 * The holdings allocation strip's arithmetic: each holding's share of the
 * holdings' total value, grouped into at most five named segments and one
 * "Other", largest first. Pure; the strip and its legend swatches read it.
 */

export type AllocationInput = { key: string; name: string; valueUsd: number };

/** Ink tones 0..4 step down in the strip; this index is the muted "Other" tone. */
export const OTHER_TONE = 5;
export const MAX_NAMED = 5;
/** A holding under this share of the total is folded into Other. */
export const MIN_SHARE = 0.02;

export type AllocationSegment = {
  /** The holdings this segment draws: one, or several for a merged Other. */
  keys: string[];
  name: string;
  /** 0..1 of the total value. */
  share: number;
  /** Whole percent; the segments' percents sum to 100. */
  percent: number;
  tone: number;
};

export type Allocation = {
  segments: AllocationSegment[];
  /** Holding key to the tone of the segment it sits in. */
  toneByKey: Record<string, number>;
};

const EMPTY: Allocation = { segments: [], toneByKey: {} };

export function allocationSegments(
  holdings: readonly AllocationInput[],
  otherName = "Other",
): Allocation {
  if (holdings.length < 2) return EMPTY;
  // A value that is not a finite, non-negative number means the shares would
  // be wrong, so there is no strip rather than a guessed one.
  if (holdings.some((holding) => !Number.isFinite(holding.valueUsd) || holding.valueUsd < 0)) return EMPTY;
  const total = holdings.reduce((sum, holding) => sum + holding.valueUsd, 0);
  if (!(total > 0) || !Number.isFinite(total)) return EMPTY;

  const sorted = [...holdings].sort((a, b) => b.valueUsd - a.valueUsd || a.key.localeCompare(b.key));
  const named: AllocationInput[] = [];
  const rest: AllocationInput[] = [];
  for (const holding of sorted) {
    if (named.length < MAX_NAMED && holding.valueUsd / total >= MIN_SHARE) named.push(holding);
    else rest.push(holding);
  }

  const drafts: Omit<AllocationSegment, "percent">[] = named.map((holding, index) => ({
    keys: [holding.key],
    name: holding.name,
    share: holding.valueUsd / total,
    tone: index,
  }));
  if (rest.length > 0) {
    const restValue = rest.reduce((sum, holding) => sum + holding.valueUsd, 0);
    drafts.push({
      keys: rest.map((holding) => holding.key),
      // One leftover holding is named; several are "Other".
      name: rest.length === 1 ? rest[0].name : otherName,
      share: restValue / total,
      tone: OTHER_TONE,
    });
  }
  if (drafts.every((draft) => draft.share <= 0)) return EMPTY;

  // Largest remainder: floors first, then the leftover points to the largest
  // fractions, so the whole numbers add to 100.
  const floors = drafts.map((draft) => Math.floor(draft.share * 100));
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = drafts
    .map((draft, index) => ({ index, fraction: draft.share * 100 - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }

  const segments = drafts.map((draft, index) => ({ ...draft, percent: floors[index] }));
  const toneByKey: Record<string, number> = {};
  for (const segment of segments) for (const key of segment.keys) toneByKey[key] = segment.tone;
  return { segments, toneByKey };
}
