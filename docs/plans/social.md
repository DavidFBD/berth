# Social: usernames, Salutes, crew

Status: plan, 2026-09-28. No code yet. Depends on account-linking phase 1
(`docs/plans/account-linking.md`): one account per verified email, `users.email_verified_at`,
`user_identities`.

## Position

Berth ranks people on craft, never on money. Boards use XP and Salutes, never
returns. A profile never shows a dollar amount, a wallet address or a holding.

This supersedes ADR-0003 (no leaderboard). Write ADR-0005 in the same round as
phase 2, citing David's decision, and update CONTEXT.md's "Settled decisions".
ADR-0003's own argument matters here: the XP economy was left loose "because
nobody can win anything by farming it". A crew board changes that, so the caps
below are not optional.

Order of work: 1) usernames, profile card, Salutes; 2) crew and crew board;
3) opt-in performance line; 4) maybe a Berth score.

## The one hard problem: order XP is trading frequency

`pour_in` and `pour_out` pay 100 XP per order. A board ranked on raw XP
therefore ranks how often someone trades, which is exactly the engagement
pattern regulators object to and the opposite of "craft". Recommendation: the
board counts **board points**, not lifetime XP:

- XP earned this month, with order XP (`pour_in` + `pour_out`) capped at
  300 per month (three orders). `held_30_days`, `friend_poured`, email and
  the other kinds count in full.
- Plus salute points: new Salutes received this month, capped at 10.
- Lifetime XP and rank stay what they are on the profile; only the board
  uses the capped figure.

## Data model

All in `db/schema.sql`, idempotent like the rest.

- **handles**: `user_id` (pk, fk users), `handle` (as typed, for display),
  `handle_norm` (unique), `created_at`, `changed_at`. Normalization, stated
  once in a `lib/handle` rulebook like `lib/invite-code`: NFKC, lowercase,
  `[a-z0-9_]`, 3 to 20 characters, no leading or trailing underscore, then a
  confusable fold (`0→o`, `1→l`, `5→s`, repeated underscores collapsed) so
  `h4rbour` and `harbour` collide. Uniqueness is on the folded form. One
  change per 30 days.
- **handle_reserved**: `handle_norm` pk, `reason` (`house`, `rank`, `listing`,
  `offensive`, `retired`), `until` (null = forever). Seeded with Berth,
  admin, support, staff, help, every rank name, every listing name and
  ticker, SODAX and team names. A retired handle is held 90 days so nobody
  can take a name the moment it is dropped. Offensive words: a maintained
  list checked as whole word and as substring on the folded form.
- **profiles**: `user_id` pk, `visible` (bool, true once a handle is picked),
  `hidden_at`, `perf_line` (bool, default false), `perf_benchmark` (one of
  the five comparison benchmarks), `updated_at`. No handle, no row, no
  profile.
- **salutes**: `giver_id`, `recipient_id`, `first_at`, `revoked_at`;
  primary key `(giver_id, recipient_id)`, check `giver_id <> recipient_id`.
  Revoke sets `revoked_at`; salute again clears it but keeps `first_at`, so
  toggling cannot mint a new salute point in a new month.
- **crew_requests**: `id`, `from_id`, `to_id`, `via` (`handle` | `link`),
  `status` (`pending` | `accepted` | `declined` | `withdrawn`),
  `created_at`, `responded_at`; unique pending pair.
- **crew_members**: `a_id`, `b_id` with `a_id < b_id` (one row per pair),
  `since`. Crew capped at 50; pending outgoing requests capped at 20.
- **crew_links**: `token` (unguessable, invite-code alphabet), `user_id`,
  `created_at`, `revoked_at`. Separate from the referral code (see open
  decisions).
- **blocks**: `blocker_id`, `blocked_id`, `created_at`, pk on the pair.
- **reports**: `id`, `reporter_id`, `target_id`, `handle_snapshot`,
  `reason` (`name`, `impersonation`, `other`), `status`, `created_at`.
- **social_audit**: `actor_id`, `action` (handle set or changed, hide,
  unhide, salute, revoke, crew request, accept, remove, block, report,
  moderator rename), `target_id`, `meta` jsonb, `created_at`. The evening
  cron keeps a year.

## Privacy and abuse

- **Enumeration.** Lookup is by exact handle only, signed in, and answers the
  same "No one by that name" for missing, hidden, blocked and blocking. No
  prefix search, no suggestions, no directory, no contact upload, no public
  web page at `/u/handle` (the card lives in the app; a share card, if any,
  is `noindex`). The username picker's availability check is itself an
  oracle: signed in, verified email only, and rate limited.
- **Rate limits** reuse the `oauth_rate_limits` hour-bucket pattern: 30
  lookups, 20 availability checks, 20 crew requests, 60 salute changes per
  account per hour, plus per-IP buckets for lookups.
- **Sybil resistance.** Giving a Salute, sending a crew request and appearing
  on a board all need a verified email. The monthly salute cap bounds what a
  ring of fake accounts can buy: ten points, at most. Referral XP already
  pays only at a verified order.
- **Block.** Silent and total. Removes the crew pair, withdraws pending
  requests both ways, revokes Salutes both ways, hides each from the other's
  board and lookup. The blocked person is never told.
- **Hide.** One switch; the profile and its handle answer "No one by that
  name", Salutes and crew stay stored, boards show "A hidden member" to
  existing crew or drop the row (open decision). Unhide restores it.
- **Moderation.** Report is one tap on a card. A moderator can force a
  rename to a neutral `member_xxxx`, which retires the old handle forever and
  writes `social_audit`. No free text anywhere in phases 1 to 3, so the
  handle is the only thing to moderate.

## XP and Salutes

Recommendation: **no XP for giving or receiving a Salute.** Salutes already
count on the board, so XP would count them twice. Rank opens real things
(Ask at Slip, invites at Berth Holder, faces at Pier and up), so salute XP
would let a ring of friends unlock them. And a Salute should mean "well
sailed", not "pay me back". Picking a username could pay a small once-only
award like `avatar_set` (25 XP) as the nudge to opt in; that is the only new
kind proposed.

## Screens (one mobile screen each)

**Phase 1**
- Username picker: in the account drawer, "Pick a name". Live check, the
  rules in one line, a clear note that picking a name makes the card
  visible to people who know it.
- Profile card: avatar, handle, rank glyph and name, XP, member since,
  Salutes count. Nothing else.
- Salute button on someone else's card: "Salute", then "Saluted" with undo.
  Disabled with a reason for accounts without a verified email.
- Privacy row in the drawer: "Hide my card", "Blocked people".
- Card overflow: Block, Report.

**Phase 2**
- Crew list: members, pending in, pending out, "Add by name", "Share crew
  link".
- Crew board: this month, board points, you always shown; tap a row for the
  card. A one-line (i) says how points are counted.
- Share and invite: system share sheet with the crew link; landing on a crew
  link signed in shows the card and "Join their crew".

**Phase 3**
- Performance line on the card, opt-in, with a benchmark picker: "Since
  joining, 4.2% ahead of the S&P 500 fund". Shown only after 20 market
  days, never on a board, never in any ranking.

## Copy direction

Plain and calm, harbour imagery allowed, no dashes as punctuation, every
string in `src/lib/copy.ts`. Examples:

- "Pick a name. Until you do, nobody can find you."
- "Only people who know your name can see your card."
- "Salute" / "Saluted" / "You saluted Mira."
- "Your crew" / "Ask to join your crew" / "Mira is in your crew now."
- "Crew board, September. Points come from what you do in Berth, not what
  you earn."
- "No one by that name."
- "Past results say nothing about what comes next."

Avoid: "beat", "win", "top trader", "streak", any money figure on a card.

## Assistant

New read tools in `lib/server/berth-tools/registry` under `berth.read`:
`get_my_profile` (own handle, visibility, Salutes count, rank) and
`get_my_crew_board` (handles, ranks and board points of crew, exactly what the
board shows). No tool looks up other handles, reads another person's
Salutes list or another person's performance line, even when opted in. No
social writes (salute, request, block) through the assistant. `mcp_calls`
already stores no arguments, which keeps handles out of the logs.

## Regulatory notes

- ESMA and the AFM have both flagged digital engagement practices in retail
  investing: points for trading, leaderboards, social comparison, nudges.
  Tokenised stocks put Berth close to that territory whatever the licence
  question turns out to be.
- Return leaderboards are the clearest case: they reward risk and size,
  invite copying, and read as a promotion of results. Hence none, ever.
- The order XP cap above answers the frequency concern for the XP board.
- Showing any person's performance to others (phase 3) is the part most
  likely to be read as a marketing communication. Legal read before phase 3,
  and before any Berth score. A Berth score, if built, rewards steadiness
  against a benchmark over rolling 90 days, never trade count.

## Metrics

- Share of active accounts with a handle; hide rate after picking.
- Salutes per visible profile, and concentration (top 10% share).
- Crew request acceptance rate, median crew size, time to first crew.
- Block and report rate per 100 profiles; forced renames.
- 30 day retention, crew members against non-members.
- Orders per account before and after joining a crew. A rise is a warning,
  not a win.
- Assistant calls to the two new tools.

## Effort

- Phase 1: 4 to 5 days (handle rulebook and reserved lists, profiles,
  salutes, blocks, reports, audit, picker, card, tests on PGlite).
- Phase 2: 3 to 4 days (requests, members, crew links, board points query,
  two screens, ADR-0005).
- Phase 3: 2 days of build from `portfolio_days`, plus the legal read.
- Phase 4: unsized until there is 90 days of history and a legal answer.

## Open decisions for David

1. Board points: cap order XP per month (recommended, 300) or leave raw XP.
2. Board window: this month only, or also all time.
3. Crew link: its own token (recommended; works below Berth Holder) or the
   referral code, which also pays referral XP.
4. Salute eligibility: verified email only, or also one filled order.
5. A hidden crew member on the board: dropped, or "A hidden member".
6. The 25 XP award for picking a username: yes or no.
7. Harbour-wide board later: which rank to opt in from, and whether it
   shows handles or ranks only.

## Confirmed by David (2026-09-28)

- ADR-0005 replaces ADR-0003's "no leaderboard" for the crew board, with anti-farming caps.
- Boards rank "board points": XP earned this month with order XP capped at 300 a month, plus at most 10 salute points. Never raw lifetime XP, never returns.
- Salutes give no XP. Crew invites use their own token. The Assistant gets read-only tools for your own profile and your crew board only.

## Crew is the connection (David, 2026-09-28)
- "Crew" is the friend connection: mutual, by request. A profile shows your relation to that person only: nothing, "Invite to your crew", "Invite sent" (cancel), "Wants you in their crew" (accept / decline, decline is silent), "In your crew" (leave).
- Nobody can see another person's crew list. Only you see yours. Crew counts are not shown on profiles.
- Salutes stay separate from crew: you can salute anyone whose profile you can open.
- Built so a future crew timeline (crewmates' trades, opt-in per person) can read from crew membership, but no timeline now.

## Naming (David, 2026-09-28): "Friends", not "crew"
UI copy says Friends everywhere: "Add friend", "Friend request sent", "Wants to be friends" (accept / decline), "Friends" (remove). The board is the "friends board". Harbour flavour stays in Salutes and ranks. Internal table names may stay `crew_*` or become `friend_*`; prefer `friend_*` for new code.

## Referral is friendship (David, 2026-09-29)
- A referral that binds (the invite link, or the code typed by hand) makes the two accounts friends at once, both ways, no request. A block either way stops it; a full list (50) on either side skips it silently; the referral stands either way. One `social_audit` row (`friend_referral`). Merges already carry friendships to the survivor. Existing pairs: `pnpm referral-friends:backfill` (dry run by default). ADR-0006.
- The referred side's panel says "You and NAME are now friends." under "A friend invited you".
- Same day: the invite code binds on the account's first sync, whichever request created the row. Before, only the request that created it could bind, and a wallet sign in often creates it in another route (the referred account from David's link on 2026-09-29 lost its code this way and was claimed by hand).

## Find a friend (David, 2026-09-29)
- A "Find a friend" field in the drawer's Friends fold and on /friends: an exact username (lowercased as typed, the picker's rulebook), looked up only on Find, never as you type. The card comes with the usual actions. Missing, hidden and blocked either way all answer "No one by that name." Verified email only (403 otherwise, the same for every name), shared with the /u/<name> card (same email gate, fixed answer without one), 30 lookups an hour per account (`SOCIAL_LIMITS.find`). Social op `find`.
