These are thoughts I'm writing down whilst I wait for our session limit to reset:

_(Struck-through = tackled — with a short status note from Claude. 🟡 = partially done. Finished rounds get compressed to one-liners to keep this readable; git history holds the detail.)_

## Settled rounds (compressed)

- ~~Privy email login as the default, wallet demoted to desktop~~ → **Done** for EVM + Solana embedded wallets; funding via address copy/QR/Privy modal. Bitcoin/Sui/Stellar/NEAR embedded signers deferred; Stacks/ICON stay external-only.
- ~~Design system via Claude Design master prompt~~ → **Done**, implemented app-wide.
- ~~Abstract away crypto language into the tea game~~ → **Done**: Earl Grey / English Breakfast / Sencha, full tea voice.
- ~~Phosphor duotone icons~~ → **Done.**
- ~~Desktop stage: looping video + hand holding an iPhone~~ → **Done**, assets baked and shipped in `public/stage/`.
- ~~Info button explaining how this was vibed with SODAX~~ → **Done**, and now retold per mode (see below).
- ~~0.1% fee to 0xbe59…Ca23~~ → **Done and verified earning on-chain** (SODA, sodaBTC, lsodaWEETH, BNB sitting at the fee wallet on Sonic). Claim later via `sodax.partners.feeClaim.*`. **Raised to 0.4% on 2026-08-07**; the disclosure line now derives from the config so copy can't go stale, framed as keeping the tea warm and the flavours curated. Note: charged both directions, so a round trip costs ~0.8%.
- ~~Native Bitcoin in and out~~ → **Done** via USER-mode PSBTs, 546-sat dust guard.
- ~~LSTeaTime lore~~ → **Done**: footer + info sheet. Fuller lore page still an option.

- ~~Rewards round (2026-08-07): accounts, avatars, XP~~ → **Done end-to-end.** Neon Postgres `users` + `xp_events` ledger (tx-hash dedup), 8 preset tea avatars, XP for pours both directions (verified against the hub receipt), welcome/email-link/avatar/theme-first-taste awards, ranks New Leaf → Tea Sage. Info drawer retold in all six voices; quiet "house rules" fee line in every voice; rewards copy never mentions fees or trading.

## Deferred / next

- **SIWE (sign-in with Ethereum) for wallet-only users.** Right now wallet-guest mutations are trusted by address; worst case an imposter changes someone's teapot avatar. Fine for launch, tighten if XP ever gains real-world value.
- **Pour ownership proof.** Pour XP requires a real, successful hub tx (invented or failed hashes pay nothing, hashes pay once ever), but the server doesn't yet prove the hash belongs to the caller. Harden by decoding the intent's creator if it matters later.
- **Account linking edge**: one human with separate email and wallet histories stays two accounts unless they connect the wallet while signed in. Acceptable for a game.
- **Leaderboard** (Upstash sorted sets) — explicitly not now.
- **Partner fee claiming flow** (`feeClaim.setSwapPreference` + auto-swap to a stable) — fees are accruing, claiming is manual for now.
- Fuller lore page / onboarding moment.
- ~~I'd love a theme that is Aurora, it should be Finland themed aurora borealis with beautiful aurora filles skies as backgrounds, reference to sauna's and Finland in general~~ → **Done** (2026-08-07): seventh mode `aurora`. Arctic-night palette (aurora green primary, violet accent, sauna-ember cup), Poiret One display font, night-sky silk, full Finnish voice (löyly steam, stove for burner, revontulet fox-fire lore in the pour celebration, "No niin" on success). Verified in webkit.
- ~~Referral program Phase 1 (verifiable invites, XP rewards)~~ → **Done** (2026-08-07). Every account gets a lazy-minted 8-char code (`users.referral_code`); invite links are `/?ref=CODE`, pocketed in localStorage at first paint (survives the AuthGate) and bound server-side ONLY to accounts created in that same request, so codes can't retro-claim old accounts and self-referral dies in the SQL. The payout moment is verifiability itself: nothing at signup; when the invited account's first verified pour lands, referrer gets `friend_poured` 250 XP (deduped by referred id, once per friend) and the friend gets `invite_accepted` 50 XP. Invite row lives in the tea service panel (tap to copy). **Rank tiers left unchanged on purpose**: pours already make XP unbounded, and referral XP is capped by real friends who really pour; revisit only if a leaderboard arrives. **Phase 1.5 known gap**: the account-linking edge (email + wallet = two accounts) makes light self-referral possible; it costs a real pour per fake friend, acceptable for XP, must be closed (SIWE + linking) before Phase 2.
- **Referral Phase 2 (real USDC alongside XP, ~$5/$5 funded from a 100 USDC pot)** — deferred. Prereqs: SIWE hardening, pour-ownership proof, minimum-pour-size threshold, and a funded payout wallet with claim flow. The ledger already records everything needed to audit retroactively.
