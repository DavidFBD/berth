# Recurring buys, around the clock, and email (plan, 2026-09-29)

Three features that lean on each other: recurring buys need a reminder, a reminder wants email, and a Saturday reminder needs the "US market closed" line. Read against master `ec05ec8`.

**One conflict first.** CONTEXT.md lists "recurring DCA" under *Cut, do not build*, and "agent as wallet" beside it. What follows is not the cut feature. The server never signs and nothing buys by itself. Berth sets a reminder with a draft attached, and the person signs it or lets it pass. David has to lift or reword that line (suggested: "Cut: automatic recurring buys. Allowed: recurring reminders with a draft, signed by the person") before any of feature 1 ships. Until he does, feature 1 is a proposal.

## Phasing

1. **Around the clock** first. It is mostly copy plus `lib/market-calendar` and needs no new vendor. The weekend checks it depends on (below) also decide whether a Saturday reminder makes sense.
2. **Email foundation** next: domain, React Email templates, preferences, unsubscribe, webhooks, and the security notices first because they carry no opt-in question. Then the limit order notices, since limit orders already exist.
3. **Recurring buys** last. It is only honest once a reminder can reach someone who is not in the app, and it needs the cut lifted.

---

## 1. Recurring buys ("Berth reminds you; you sign")

A schedule per person: listing, dollar amount, weekly or monthly, a day. Each time it comes due, Berth makes a prefilled draft and says so, both in the app and by email. One tap opens the order drawer with everything filled in. The person picks what to pay with and signs. If they don't, that run is marked skipped, which is fine and shown as such.

**Why no auto execution now.** The options: ERC-7715 permissions (wallet grants a dapp a spend allowance), ERC-4337 session keys, or Privy server signers / delegated actions on the embedded wallet. All three would let Berth or a key it controls sign a cross-chain intent without the person present. That is the "agent as wallet" cut in another form, and it changes what Berth is. Today Berth is software that never holds keys and never moves money (features.md, "Your custody, always"; privacy policy "Berth cannot sign for you"). Holding standing authority to trade a person's funds on a schedule is also the thing regulators describe as discretionary or automated order handling, which is broker or investment firm territory in most jurisdictions (MiCA and MiFID in the EU, where Berth's users are). It would also cover only Privy embedded wallets, not extension wallets, and not Bitcoin payers. Revisit only with legal advice and as a separate decision record.

**Data model** (`db/schema.sql`, idempotent like the rest):
- `recurring_plans`: `id`, `user_id` (cascade), `listing_symbol`, `usd numeric` (floored by `MIN_POUR_USD`, capped by `MAX_DRAFT_USD`), `cadence` (`weekly` | `monthly`), `weekday smallint` (0 to 6, weekly) or `month_day smallint` (1 to 28, monthly, so February never skips), `order_type` (`market` | `limit`), `dip_pct numeric` (limit only, e.g. 5 means 5% under the price at reminder time), `status` (`active` | `paused` | `ended`), `created_via` (`app` | `assistant`), `next_due date`, `created_at`, `updated_at`. At most 5 active plans per account.
- `recurring_runs`: `id`, `plan_id`, `due date`, `unique (plan_id, due)`, `reminded_at`, `emailed_at`, `outcome` (`pending` | `signed` | `skipped`), `order_id` / `limit_order_id` (nullable, set when the draft opened from this run is signed), `closed_at`. A run left pending for 7 days, or still pending when the next one comes due, becomes `skipped`.
- Linking a signed order to its run: the draft link gains `run=<id>`. `readDraftParams` in `lib/draft-order` carries it through, and the pour route writes `order_id` when it records the order. Nothing else changes in the order machine (`use-vault-action` stays whole).

**Cron.** `/api/cron/evening` runs on weekdays only and already spends most of its 60 s budget (47 s snapshot deadline), so the reminders go on the other slot. `/api/cron/held` at 06:00 UTC fires every day, and the hold check is light. Rename it to a **morning run** (`/api/cron/morning`, `lib/server/morning`) with stages in order and a budget for each, the way `runEvening` does it: hold check, recurring runs due today (insert the run, set `next_due`, queue the in-app strip, send the reminder email), then the email digests. 06:00 UTC is 08:00 in Amsterdam, which is right for a European audience. Hobby crons fire somewhere inside the scheduled hour, so no copy should promise an exact minute. This keeps us at two crons and needs no Pro plan.

**Buy on the dip (limit option).** Only shown to accounts with the limit orders switch on. The reminder's draft is a limit buy at `dip_pct` below the price at the moment the draft opens, expiring the day before the next run, so plans never pile up. Only the draft prefills a price. The resting order and its fill notice are the existing limit order path.

**XP and streaks.** No XP for how often someone trades, no streaks, no "don't break the chain". A run that fills earns the ordinary order XP it would earn anyway (still capped at 300 on the friends board). At most, one once-only kind `plan_set` (e.g. 20 XP) the first time an account sets a plan, idempotent like `avatar_set`. Skipping costs nothing and is never framed as a loss.

**Assistant.** Two new tools in `lib/server/berth-tools/registry`: `list_plans` (scope `berth.read`) and `draft_plan` (`berth.draft`). `draft_plan` returns a link that opens the plan sheet prefilled, and the person saves it. The Assistant cannot save, pause or delete a plan itself, the same way it cannot sign an order. It can explain a skipped run.

**Screens**
- Order drawer: a quiet "Repeat this" row under the amount, opening a sheet with weekly or monthly, a day picker, and "Buy on the dip" (switched on accounts only).
- Under the account total, a strip only on a due day: "Your weekly NVIDIA buy of $50 is ready to sign." Tapping it opens the drawer. It goes away once signed or skipped.
- Account drawer, "Plans": each plan with its next date, the last runs (signed, skipped), and Pause, Edit, End.

**Copy direction.** "Berth reminds you. You sign." "Skipped. That is fine, the next one is on 6 October." "Nothing is bought until you sign." Never "automatic", "autopilot", "set and forget" or "DCA", and never a claim that regular buying lowers risk.

**Effort.** About 4 to 5 days: schema and plan rulebook with unit tests (next due date, the 28th rule, skip aging) 1.5, morning cron stage 1, UI 1.5, Assistant tools 0.5.

**Risks.** Reminders nobody acts on become noise (mitigation: after 3 skips in a row, pause the plan and say so). Reminder fatigue ends up as email complaints, which hurt the sending domain. Copy that drifts toward "invest regularly" reads as advice.

**Open for David:** lift the cut (exact wording). The plan cap (5?). Whether `plan_set` XP exists at all. Whether a plan can pay from Bitcoin (the draft can't pick a pay token today, so it stays the person's choice in the drawer).

---

## 2. Around the clock

Stock tokens change hands when US markets are shut, so Berth should say so plainly and give the facts, without cheering it on.

**What to verify before any copy ships** (David's live test, like the limit order one):
1. Do SODAX solvers quote and fill stock token buys and sells on a Saturday and at 03:00 New York time on a weekday? Record the size, spread against the Friday close, and time to fill.
2. What does the solver oracle (`/api/listing-prices`) return on a weekend? Does it freeze at the Friday close, keep moving with the thin onchain venue, or go stale? Is there a staleness flag we should read?
3. Does the Robinhood token issuer pause anything (mint, redeem, transfers) over weekends or holidays, and what happens to the token around corporate actions and splits?
4. Does a limit order resting over the weekend fill at the Monday open gap, and at what price?
5. Does DefiLlama still mark around 08:50 New York (the time `listing-performance` documents), and do weekend points stay filtered by `lib/market-calendar`?
6. Does quote slippage widen enough on weekends that the drawer's slippage floor starts refusing orders?

If item 1 fails, the line becomes "US market closed. Orders may wait for the open." Say only what is actually true.

**Data model.** No new table. `lib/market-calendar` gains `marketStatus(now)` returning `open` | `closed` | `early_close` plus `nextOpen`, with New York time zone and daylight saving, the existing `marketHolidays`, and half days (day after Thanksgiving, 24 December, 3 July), all unit tested. The price gap compares the listing's live price with the last official close. Official closes come from the Nasdaq source already named in the privacy policy, cached daily, and are stored in `marks` if they are not there already.

**Screens**
- Listing rows and the order drawer, only while closed: "US market closed. Berth still trades. Opens Monday 15:30 your time." The time is in the person's local zone.
- Drawer, while closed: one fact line, "Last close $182.40. Now $184.10, 0.9% above." No colour for up or down, no arrow, one (i) explaining that token prices can differ from the share when the market is shut.
- Welcome: one line, "Buy when you like, weekends included."
- The moves and news column keeps running on weekends. "What moved" measures against the last close and says it did.

**Copy direction.** Facts and times, never urgency. Avoid "don't wait for Monday" or "beat the open".

**Effort.** 1.5 days after the checks: calendar and tests 0.5, UI 0.5, the gap line with its close source 0.5.

**Risks.** Thin weekend prices can show a gap the share never gets, so the (i) must say it. Getting daylight saving wrong puts the next-open time off by an hour twice a year.

**Open for David:** the results of checks 1 to 6. Whether the gap line shows on weekends only or overnight too.

---

## 3. Email with Resend

**Where the address comes from.** Only the account's verified primary email identity (`user_identities` where `kind = 'email' and is_primary`), never the legacy `users.email` column alone and never an address typed without a Privy code. Wallet-only accounts get in-app notices only. In the account drawer they see "Add an email to get these by mail", using the existing add-email flow. When the primary email changes or is unlinked, sending follows at once and the security notice goes to both old and new.

**Setup.** Sending subdomain `mail.berthmarkets.com` (SPF, DKIM and a return path on the subdomain, DMARC starting at `p=none` and moving to `quarantine` after two clean weeks), so the apex domain's reputation stays apart. From `Berth <hello@mail.berthmarkets.com>`, with reply-to the privacy contact. Env: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_TOKEN_SECRET` (HMAC for links), `EMAIL_FROM`, all in `.env.local` and on Vercel, and `EMAIL_SENDING=off` as a kill switch.

**Templates.** React Email components in `src/emails/`, one layout matching the quieter Seline dress: warm paper background, one white card with one hairline, Inter Tight heading, Public Sans body, Plex Mono for numbers, one pill button, the blue used for that button only, the mark in the header. A plain text part always. Every string is a key in `copy.ts` (a new `email` group). There is a dev gallery at `/dev/email`, a 404 in production, and `pnpm shot` covers it.

**Types and defaults**
- **Security** (always on, cannot be turned off): wallet added, wallet removed, accounts merged, an AI connected (app name and scopes), primary email changed. Each ends with "Not you? Write to us" and a link to the account drawer.
- **Orders** (on): limit order filled, limit order expired, recurring reminder.
- **Weekly summary** (**off by default**, offered once): the week's value against the benchmark the person picked, what filled, the next plan date. It goes out Monday in the morning run. It is off by default because it is the one type the person did not trigger. Berth's voice is calm, and a first unasked email from a money app reads as marketing, which under the EU ePrivacy rules would need consent anyway. It also protects the free tier (below). It is offered once, as a toggle in the settings drawer and in one quiet line after the first filled order.
- **Friends** (on): a friend request received (one email, no more than one a day, then batched), and Salutes as part of a weekly digest, never one email per Salute.

**Data model**
- `email_prefs`: `user_id` pk, `orders bool default true`, `weekly bool default false`, `friends bool default true`, `updated_at`. Security has no column because it is not optional.
- `email_suppressions`: `address` (normalised) pk, `reason` (`bounce` | `complaint` | `unsubscribe_all`), `at`. It is checked before every send and blocks everything except security notices after an `unsubscribe_all`. A hard bounce or complaint blocks security notices too, because the address is dead or hostile, and the app then shows the notice in-app instead.
- `email_sends`: `id`, `user_id`, `type`, `ref` (the order or run id), `resend_id`, `sent_at`, `unique (user_id, type, ref)`. This makes every send idempotent across cron retries, and the same key goes out as Resend's `Idempotency-Key`. It stores no body and no address.

**Unsubscribe.** Every non-security email carries `List-Unsubscribe: <https://www.berthmarkets.com/email/u?t=TOKEN>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). POST switches that type off and returns 200 with an empty body, and GET shows a one-screen page with the other toggles. The token is an HMAC-signed `{userId, type, exp}` with no email and no raw id in the URL. Deep links in emails (to the drawer or a draft) carry only what the app already accepts plus a signed `run` token.

**Webhooks.** `POST /api/email/webhook`, verified with `resend.webhooks.verify()` against the three `svix-*` headers and `RESEND_WEBHOOK_SECRET`, raw body. `email.bounced` (permanent) and `email.complained` write a suppression, and `email.suppressed` is recorded too. Everything else is ignored, since Berth does not track opens or clicks and both stay off in Resend.

**Rate limits and volume.** Resend allows 10 requests per second per team. Batch sends take up to 100 emails, with no attachments and no scheduling. The morning run sends digests in batches of 100, one request at a time. The free tier is 100 emails a day and 3,000 a month, which a weekly digest plus reminders will outgrow quickly, and a security notice must never bounce off a daily cap. Plan on Pro ($20 a month for 50,000) before the weekly summary or recurring reminders open to everyone. Security and order notices send right away from the route that caused them, while digests wait for the morning run.

**Privacy policy** (`copy.ts` `privacyPolicy`): add Resend to "Who we share it with". It receives your email address, the notice's content (listing names, amounts, prices, a friend's username) and delivery events. A new "Email" section says which emails exist, which cannot be switched off and why, that we do not track opens or clicks, and how to unsubscribe. The retention section gets `email_sends` metadata (for example 12 months) and suppressions (kept while the account exists, so the block holds). Bump the effective date.

**Screens**
- Settings drawer, a new "Email" section: three toggles (Orders, Weekly summary, Friends) and a fixed line "Security notices always go to you@…". A wallet-only account sees the add-email line instead.
- The unsubscribe page, one screen.
- The in-app side is unchanged: toasts and strips stay the primary channel. Email reaches people who are not in the app, and the Announcer never waits on it.

**Copy direction.** The subject says what happened: "Your NVIDIA order filled at $198.20". "A wallet was added to your Berth account". Body: one fact, one button, one line on why this email arrived. No exclamation marks, no "Don't miss", no emoji, no dashes as punctuation.

**Effort.** About 4 to 5 days: domain and DNS 0.5 (DNS changes are David's), layout and six templates 1.5, prefs, suppressions and sends with tests 1, unsubscribe and webhook 1, privacy policy and settings UI 0.5.

**Risks.** Deliverability on a new subdomain, so warm up with security and order notices only. Security emails that look like phishing: never ask for a code or a click to "secure" anything, and link only to berthmarkets.com. Wrong address after a merge, so always read the primary identity at send time and never cache it. Free tier caps.

**Open for David:** confirm weekly off by default. Pro plan timing. Sender name and address. Whether Salutes appear in email at all or stay in-app. DMARC ownership of berthmarkets.com DNS.
