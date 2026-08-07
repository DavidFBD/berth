/**
 * The mode id list, alone. copy.ts owns everything a mode says (the whole
 * six-voice script), but the theme XP route only needs to know which ids
 * exist — importing the full copy module into a server bundle for that would
 * be absurd. This module is that one fact; copy.ts derives its ModeId from
 * here, so there is exactly one source of truth.
 */
export const MODE_IDS = [
  "original",
  "gangster",
  "nan",
  "terminal",
  "vaporwave",
  "sumie",
] as const;

export type ModeId = (typeof MODE_IDS)[number];

export function isModeId(value: unknown): value is ModeId {
  return (
    typeof value === "string" && (MODE_IDS as readonly string[]).includes(value)
  );
}
