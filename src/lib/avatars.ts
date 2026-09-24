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
  /**
   * The three faces below unlock with rank. `unlockLevel` is the rung on
   * the ladder (src/lib/xp.ts RANKS) from which the face can be picked; the
   * server checks it too, the picker only decides how to say it.
   */
  { id: "beacon", label: "The Beacon", src: "/avatars/beacon.svg", unlockLevel: 7 },
  { id: "bell", label: "The Bell", src: "/avatars/bell.svg", unlockLevel: 8 },
  { id: "capstan", label: "The Capstan", src: "/avatars/capstan.svg", unlockLevel: 10 },
] as const;

export type AvatarId = (typeof AVATARS)[number]["id"];
export type Avatar = (typeof AVATARS)[number];

/** The rank level from which a face can be picked; 1 for the open set. */
export function avatarUnlockLevel(id: AvatarId): number {
  const avatar = AVATARS.find((a) => a.id === id);
  return avatar && "unlockLevel" in avatar ? avatar.unlockLevel : 1;
}

/** Whether an account at `level` may wear this face. */
export function canUseAvatar(id: AvatarId, level: number): boolean {
  return level >= avatarUnlockLevel(id);
}

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
