These are thoughts I'm writing down whilst I wait for our session limit to reset:

_(Struck-through = tackled — with a short status note from Claude. 🟡 = partially done. Finished rounds get compressed to one-liners to keep this readable; git history holds the detail.)_

## Settled rounds (compressed)

- ~~Privy email login as the default, wallet demoted to desktop~~ → **Done** for EVM + Solana embedded wallets; funding via address copy/QR/Privy modal. Bitcoin/Sui/Stellar/NEAR embedded signers deferred; Stacks/ICON stay external-only.
- ~~Design system via Claude Design master prompt~~ → **Done**, implemented app-wide.
- ~~Abstract away crypto language into the tea game~~ → **Done**: Earl Grey / English Breakfast / Sencha, full tea voice.
- ~~Phosphor duotone icons~~ → **Done.**
- ~~Desktop stage: looping video + hand holding an iPhone~~ → **Done**, assets baked and shipped in `public/stage/`.
- ~~Info button explaining how this was vibed with SODAX~~ → **Done**, and now retold per mode (see below).
- ~~0.1% fee to 0xbe59…Ca23~~ → **Done and verified earning on-chain** (SODA, sodaBTC, lsodaWEETH, BNB sitting at the fee wallet on Sonic). Claim later via `sodax.partners.feeClaim.*`.
- ~~Native Bitcoin in and out~~ → **Done** via USER-mode PSBTs, 546-sat dust guard.
- ~~LSTeaTime lore~~ → **Done**: footer + info sheet. Fuller lore page still an option.

## Rewards round (2026-08-07)

- ~~User accounts with profile pictures and XP for actions~~ → **Done end-to-end.** Neon Postgres (`users` + `xp_events` ledger, tx-hash dedup), preset tea avatar shelf (8 hand-drawn SVGs, no uploads = no moderation), XP on pours both directions (100 each, verified against the Sonic hub receipt), welcome 25, email link 150, avatar pick 25, first taste of each theme 10. Ranks: New Leaf → Tea Sage, theme-agnostic on purpose. Chip next to the account pill; tea service panel in the pantry and in its own drawer for wallet guests.
- ~~Info drawer retold per theme + theme-switch XP~~ → **Done**: the making-of story now speaks all six voices; each theme pays its 10 XP exactly once per account (ledger ref = account:mode).
- Fee disclosure kept quiet but present ("house rules" line in the info drawer, in every voice). Rewards copy never mentions fees or trading — it's all "rewards for playing".

## Deferred / next

- **SIWE (sign-in with Ethereum) for wallet-only users.** Right now wallet-guest mutations are trusted by address; worst case an imposter changes someone's teapot avatar. Fine for launch, tighten if XP ever gains real-world value.
- **Pour ownership proof.** Pour XP requires a real, successful hub tx (invented or failed hashes pay nothing, hashes pay once ever), but the server doesn't yet prove the hash belongs to the caller. Harden by decoding the intent's creator if it matters later.
- **Account linking edge**: one human with separate email and wallet histories stays two accounts unless they connect the wallet while signed in. Acceptable for a game.
- **Leaderboard** (Upstash sorted sets) — explicitly not now.
- **Partner fee claiming flow** (`feeClaim.setSwapPreference` + auto-swap to a stable) — fees are accruing, claiming is manual for now.
- Fuller lore page / onboarding moment.
