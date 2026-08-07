# Invites unlock at level 3

Referral programs conventionally let everyone share immediately (enthusiasm
peaks right after signup), and we rejected that on purpose (David,
2026-08-07): the invite link is a rank perk from level 3 / Warm Cup
(`INVITE_UNLOCK_LEVEL` in lib/xp). A referred newcomer arrives at level 2, so
the locked invite row doubles as their next progression goal, and the gate
adds light sybil resistance for free. Codes are still minted for every
account at first sync — only the *reveal* is gated (toProfile) — so inbound
links always resolve. Trading viral reach for a progression moment was the
point; do not "fix" this back to share-at-signup without reopening the
decision with David.
