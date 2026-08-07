/**
 * The invite code rulebook — the ONE statement of what a code is, imported
 * by every module that meets one: the mint (server), the pocket (client),
 * the OG-card gates, and the hand-claim input. Before this module the shape
 * was spelled four different ways and /r/oilfield could pocket a code the
 * mint can never produce, promising a seat that silently evaporated.
 *
 * Unambiguous lowercase alphabet: no i/l/o/0/1 lookalikes, so a code read
 * aloud over a cup of tea survives the retelling.
 */

export const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const CODE_LENGTH = 8;

const CODE_SHAPE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/**
 * The canonical form of a claimed code, or null when the mint could never
 * have produced it. Case and whitespace are forgiven; lookalikes are not.
 */
export function normalizeInviteCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return CODE_SHAPE.test(trimmed) ? trimmed : null;
}

/** Whether a value could be a minted code (after normalization). */
export function isInviteCode(value: unknown): boolean {
  return normalizeInviteCode(value) !== null;
}
