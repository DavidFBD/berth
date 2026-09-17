/**
 * The preset avatar set. A fixed gallery instead of uploads: nothing to
 * moderate, nothing to store, every face fits the harbour. Ids are what the
 * database stores; a shipped id is never renamed, so the tea-era ids below
 * keep resolving to a harbour face through LEGACY_AVATAR_IDS.
 */
export const AVATARS = [
  { id: "bollard", label: "The Bollard", src: "/avatars/bollard.svg" },
  { id: "cleat", label: "The Cleat", src: "/avatars/cleat.svg" },
  { id: "ring", label: "The Ring", src: "/avatars/ring.svg" },
  { id: "lantern", label: "The Lantern", src: "/avatars/lantern.svg" },
  { id: "buoy", label: "The Buoy", src: "/avatars/buoy.svg" },
  { id: "rope", label: "The Rope", src: "/avatars/rope.svg" },
  { id: "tidemark", label: "The Tide Mark", src: "/avatars/tidemark.svg" },
  { id: "compass", label: "The Compass", src: "/avatars/compass.svg" },
] as const;

export type AvatarId = (typeof AVATARS)[number]["id"];

/**
 * Ids stored before the rebrand (2026-09-17), mapped one to one onto the
 * harbour set so nobody's profile goes blank. New writes use AVATARS only.
 */
export const LEGACY_AVATAR_IDS: Record<string, AvatarId> = {
  cup: "bollard",
  teapot: "lantern",
  kettle: "buoy",
  leaf: "ring",
  matcha: "compass",
  lemon: "cleat",
  sugar: "rope",
  teabag: "tidemark",
};

export function isAvatarId(value: string): value is AvatarId {
  return AVATARS.some((avatar) => avatar.id === value);
}

/** The current id for a stored one: itself, or its harbour equivalent. */
export function resolveAvatarId(id: string | null | undefined): AvatarId | undefined {
  if (!id) return undefined;
  if (isAvatarId(id)) return id;
  return LEGACY_AVATAR_IDS[id];
}

export function avatarSrc(id: string | null | undefined): string | undefined {
  const resolved = resolveAvatarId(id);
  return AVATARS.find((avatar) => avatar.id === resolved)?.src;
}
