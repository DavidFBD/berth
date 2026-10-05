# Reward campaigns

> **Superseded 2026-10-05.** Campaigns no longer reward a buy (an
> inducement to trade). Since the same day a campaign (kind 'signup') pays
> the new account itself: a person who opens a new account through the
> campaign's own link (/c/<code>) inside its dates, sets it up and still
> uses Berth N days later earns the USDC, to their own home address on Base.
> A personal invite (/r/<code>) never earns money. The rules live in
> `lib/server/campaigns/eligibility.ts`; the buy campaigns below, and the
> short lived invite campaigns that paid the inviter, are retired (kind
> 'buy' or 'invite', never activated again, rows kept read only). What
> follows is the original plan, kept for history.

Built 2026-10-01 on branch `campaigns`. Not deployed; needs `pnpm db:push`
and counsel review before any campaign is activated.

## The promise

"Buy at least $10 of any stock or fund through this link, keep it for 7
days, and we add $5 in USDC." A $100 budget, 20 places. XP and ranks stay
the fun layer; they are never the trigger. Berth never sends money: David
pays each approved claim by hand and records the transaction.

## Shape

- Link: `/c/<code>` (lowercase, digits, hyphens, 3 to 32). The landing
  pockets the code only for an active campaign inside its dates and never
  where Berth is not available; the profile sync carries it
  (`campaignCode`, beside `referralCode`) and `attributeCampaign` binds it
  under the invite code's birth certificate rule: first sync, under 72
  hours, never poured, not merged. One claim per account, ever. Invites and
  friends are untouched.
- Tables: `campaigns`, `campaign_claims`, `campaign_claim_wallets`,
  `staff_audit`, and the function `campaign_reserve` (db/schema.sql).
- States: attributed, buying, holding (since, eligible), qualified,
  approved, paid, rejected (reason), expired (ended or full).
- Rules (lib/server/campaigns/eligibility.ts, every one tested):
  verified email; the first qualifying buy from `orders` (a buy, a
  `kind: "stock"` listing, which holds companies and index funds, never
  SGOV, which is cash, never a vault; `usd_value >= min_buy_usd`, an order
  with no known dollar value does not qualify; not in `no_xp_intents`;
  filled inside the campaign's dates); a slot reserved in one locked
  transaction (campaign row `for update`), so two claims racing for the
  last slot cannot both get it; one per person across merged accounts;
  one per wallet (every wallet the person ever linked, the home, the
  buy's payer and delivery wallet); budget and max_claims counted over
  holding, qualified, approved and paid.
- Hold: the morning run's campaign step (no third cron) judges holding
  claims at or after `eligible_at` with the thirty day check's rule
  (`judgeHold`, nothing paid against it): the delivery wallet's balance
  covers the buy's quantity. Held: qualified. Not: rejected, not_held.
  Unreadable: tried again tomorrow.
- Staff: `/staff/campaigns` and `/api/staff/campaigns`, behind
  `requireStaff(req, "admin")` in lib/server/staff-auth.ts (account id in
  `STAFF_ADMIN_IDS`), every action through `staffAudit()`. Create
  (always inactive), activate (only with the counsel review confirmation),
  pause, approve (fixes the payout address: the account's home address,
  USDC on Base), reject (reason), mark paid (tx hash, read only receipt
  check on Base's public RPC: verified, refused on mismatch or revert,
  stored unverified when it cannot be read; "Check again" later).
  `pnpm campaign:queue` prints the same queue, read only.
- Person: one quiet line on the home, then an email (`campaign_paid`,
  under the orders switch, same caps) when paid.

## Open

- Counsel: the terms' Campaigns section, the privacy lines, and the
  activation itself. The terms' effective date was not moved.
- Non-EVM sourced buys pass the order ownership gate unchecked
  (thoughts.md, pour ownership residual); a campaign buy is still bounded
  by one per wallet and staff review.

## Review round (2026-10-01, after the abuse and staff reviews)

- A qualifying buy is a market buy (limit buys fill at an unknown time
  and place, so they never count), made after the claim, by someone new
  to Berth (no account older than the 72 hour window, no earlier order,
  merges included), delivered to the hub wallet of one of the person's
  own EVM wallets (the home, or a linked one while linked) and, for an
  EVM payer, paid from one of them. This closes the non EVM ownership
  gap for campaigns.
- The hold is the whole window: Transfer logs of the listing at the
  delivery wallet from the fill to now, read on Sonic
  (rpc.soniclabs.com, 400k block chunks), walked back from today's
  balance; the lowest balance up to eligible_at must cover the buy.
  Read again at approval, with one per person and the wallets.
- The morning step judges first and advances open claims only until its
  deadline (8 s budget; the holds stage went to 18 s).
- A full campaign keeps a waiting line in order (waitlisted_at); expiry
  as full only after the deadline, ends_at + hold_days, which is also
  when anything not holding a slot expires.
- Payments: only USDC from STAFF_PAYOUT_ADDRESSES counts; a batch may pay
  several claims if each address gets its sum; an unreadable hash stays
  pending on an approved claim (no Paid line, no email) and can be
  checked again or replaced; a reverted or short one is cleared.
- Staff: STAFF_ADMIN_IDS via requireStaff; requireFreshStaff (Privy token
  under 15 minutes, never a wallet session) for activate, approve,
  reject, mark paid; Next's own 404 for everyone else and every other
  method; the page opens only with the berth_staff pass set on a staff
  account's profile sync; masked emails and wallets with an audited
  reveal; every write and its audit row in one statement; signed in
  non staff probes logged. The CLI reads local by default, --prod logs a
  row, --reveal unmasks.
- Needs: STAFF_ADMIN_IDS, db:push, counsel, and a payout source on each campaign (or the optional STAFF_PAYOUT_ADDRESSES fallback).

## Payout sources (2026-10-01, David's request)

Each campaign keeps its own list of payout wallets
(`campaign_payout_sources`), added and removed on its card on
/staff/campaigns by an admin with a fresh sign in, an address (all lowercase or uppercase is normalised; mixed case must pass its EIP-55 checksum)
and a reason. Each change is audited in the same statement and emailed to
every staff admin (notice `payout_source_changed`, security kind, no
switch). Mark paid accepts USDC only from an active source of the claim's
campaign. `STAFF_PAYOUT_ADDRESSES` is optional now: when set, its wallets
count for every campaign as a global fallback. Removing a source keeps
its row and never touches a claim already paid; a claim not yet paid can
no longer be paid from it.
