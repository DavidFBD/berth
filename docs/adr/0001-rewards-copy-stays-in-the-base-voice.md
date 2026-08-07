# Rewards copy stays in the base voice

Every user-facing string lives behind `useCopy()`, and eight parlours flavour
the app — but the rewards corner (ranks, XP, referrals, the ledger in
tea-service.tsx) is defined in the base voice only and reads identically in
every parlour. This is deliberate (David, 2026-08-08): your rank is your rank
wherever you drink, and rewards language that shifts with the theme reads as
unreliable exactly where trust matters. The seam stays open — a parlour MAY
override a rewards key at the usual one-override cost — but agnostic is the
default, and an architecture review proposing to "bring the pantry into the
voices" is re-proposing a rejected option.
