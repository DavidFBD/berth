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
- I'd really like to know what my options are for implementing a referral program in the current stack. In an ideal world, every user is incentivized to invite friends (verifiably) and in turn earn XP for that, and maybe further down the line earn actual on-chain funds (I could see myself funding an account with 100USDC and allowing users to invite friends and earn $5 for doing so, $5 for both the new user and the referring user). Maybe we should split if up in two phases. Phase 1 being the referral program build with sizeable XP as reward (also make sure this doesn't skew our level tiers, we may have to rework this too). Phase 2 being adding real USDC to the rewards alongside the pre-existing XP
