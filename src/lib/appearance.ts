/**
 * The appearance ids, alone. Light, dark, or whatever the device says.
 * Replaces the eight-voice mode list: the class-switched theme mechanism
 * (next-themes, persisted per browser, stamped before hydration) stays,
 * the personalities went. Kept as its own tiny module so the theme XP route
 * can validate an id on the server without importing the copy module.
 */
export const APPEARANCE_IDS = ["system", "light", "dark"] as const;

export type AppearanceId = (typeof APPEARANCE_IDS)[number];

export const DEFAULT_APPEARANCE: AppearanceId = "system";

export function isAppearanceId(value: unknown): value is AppearanceId {
  return (
    typeof value === "string" &&
    (APPEARANCE_IDS as readonly string[]).includes(value)
  );
}
