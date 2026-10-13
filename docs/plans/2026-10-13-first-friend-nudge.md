# First friend nudge (2026-10-13)

David approved: a plain, deterministic strip that teaches friends, with David as a ready-made first friend beside the
person's own friend link. Adding David pays nothing, and his card in the compare says his holdings are not advice.

## What exists today (mapped)

- Tables: `friend_requests` (db/schema.sql:626), `friends` one row per pair a_id<b_id (:642), the 50 cap trigger
  `friends_cap` (:661, held by the database), `friend_links` (:684), `profiles.visible/hidden_handle` (:584),
  `profiles.share_holdings` (:607), `profiles.staff_hidden_at` (:1648), `account_notices` (:1989).
- Flow: `lib/server/social/friends.ts` — `request()` :139 (verified email + username, OUTGOING_MAX 20, daily 20,
  sends a `friend_request` email notice :178), `acceptFrom()` :53, `relationAct()` :183, `befriendOnReferral()` :95
  (direct pair insert, no request, block and decline aware: the pattern to copy). Route: `app/api/social/[op]/route.ts`
  into `lib/server/social/ops.ts` (`friend` :106, `friends` :112, `link` :114, `holding` :156, `notices` :139).
- UI: `components/social/social-section.tsx` (friends list, find, own link, "Your friends hold" `HoldingFold` :350),
  `components/social/find-friend.tsx`, `components/social/profile-card.tsx`, `/friends` page, `/f/[token]`.
- The compare: a friend's card lists which listings they hold, names only (`profile-card.tsx:89`, `cards.ts:85`,
  `social-proof.ts friendHolds` :229), and "Your friends hold" counts per listing with faces. Only when BOTH sides
  turned `share_holdings` on (`SHARES_HOLDINGS_SQL` :156). No amounts, no weights, no Buy anywhere in either
  (listing-board.tsx:88 keeps it off the board). Consequence: a person who adds David sees nothing of his holdings
  until they turn their own switch on, and David's switch must be on.
- Nudges: `lib/nudge.ts` + `lib/server/nudge.ts` is the Jev-picked line: not used here. The deterministic strips live
  in `home.tsx` strips (:568-606): `EmailNudgeLine` (localStorage, a week), `SocialNoticeLine`/`PolicyNoticeLine`
  (server once per account via `account_notices`, `lib/server/notices.ts`, ids in `lib/social-proof.ts:275`),
  each hidden while waiting orders, the unlinked wallet prompt or the first path show. The first path
  (`lib/first-path.ts`, `lib/server/first-path.ts`) already has an `invite` step.
- No founder or house account concept exists. Staff is `STAFF_ADMIN_IDS`/`STAFF_VIEWER_IDS`
  (`lib/server/staff-session.ts:29`) and `isStaff` = @sodax.com email (`social/handles.ts:26`): both too broad.
- XP and campaigns on friend add or accept: none. No XP kind fires from `friends.ts` (awardXp callers:
  profile route, rewards-route, pour-claims, invite-xp, holds, handles). Invite XP (`invite-xp.ts`, `friend_stayed`)
  and campaign claims (`campaigns/store.ts attributeInvite` :166) key only off `users.referred_by`, which only the
  referral code or invite link sets (`accounts.ts` :431, :479). Friend links pay nothing (schema :682). Side effects
  of a friend row: first path `friend_made` closes the invite step (`server/first-path.ts:71-76`), the friends board
  (`social/board.ts`), the weekly email's `friends_added` (`weekly.ts:101`), the 50 cap on BOTH sides.

## Decisions

1. Identity: env `BERTH_FOUNDER_USER_ID` (one users.id), read in a new `lib/server/social/founder.ts`
   (`founderId(env)`, `isFounder(id)`). Unset means the feature is off everywhere. Never hardcoded.
2. No approval, rather than auto-accept: a request to the founder (from the nudge, Find, his card or his friend link)
   is turned in `request()` into `befriendFounder(viewer)`: a direct pair insert modelled on `befriendOnReferral`
   (block either way or his earlier decline stops it), any live request settled as accepted, audit
   `friend_founder`. No `friend_requests` row, so no request email to David and no queue to clear. Same gates as any
   request: verified email and a username on the asker.
3. The 50 cap: David would hit it in a day. `profiles.friends_uncapped` lets the trigger skip his side only;
   app checks (`acceptFrom`, `request`, `befriendOnReferral`) skip `friendCount` for the founder. The asker's own cap
   still holds.
4. No pay: the path never touches `referred_by`, so invite XP and campaigns cannot fire. Never offer David's referral
   code or invite link in the nudge (that is what would bind). The first path `friend_made` excludes the founder, so
   adding David does not close the person's own invite step. Tests pin all three.
5. Privacy: the suggestion is offered only while David's card is visible to this viewer (`VISIBLE_SQL`: switch on,
   email verified, no block either way, not staff hidden). Hide the card, and the strip and the row vanish on the
   next read. Existing friendships stay as any friend's do (hidden name only, per `peopleSql`). His holdings show only
   through the existing both-share rule, names only.

## Who sees it, and when

Server decides (`firstFriendOffer(viewer)` in founder.ts, op `first-friend` in ops.ts). Offered when all hold: the
founder id is set and is not the viewer; the viewer has a verified email and a username; zero friends and no live
outgoing request; David visible to the viewer; the first path not showing; `account_notices` has no `first-friend`
row. Dismiss writes that row (existing `notice-seen` op, id added to `ACCOUNT_NOTICES` so `useAccountNotice` works).
Making any friend also writes it, so removing friends later never brings it back. Never Jev, never a model call.

Places: a strip in `home.tsx` after `PolicyNoticeLine`, hidden by the same `hidden` rule; and the empty friends list
in `social-section.tsx` shows the same two rows (David, then "Share your link"). The strip shows avatar, "David, who
builds Berth", an Add button (the accent), and "Share your link" opening the drawer at friends.

## Files

- `src/lib/server/social/founder.ts` (new): `founderId`, `isFounder`, `befriendFounder`, `firstFriendOffer`.
- `src/lib/server/social/friends.ts`: founder branch in `request()`; cap skips for founder.
- `src/lib/server/social/ops.ts`: `first-friend` read op; `src/lib/social-types.ts`: `CardAnswer.card.founder?: true`.
- `src/lib/server/social/cards.ts`: set `founder` on his card answer. `src/lib/server/social-proof.ts`: mark his
  face in `friendsHolding` lines (`founder: true`) so the fold can say the line.
- `src/lib/server/first-path.ts`: exclude the founder from `friend_made`.
- `src/lib/social-proof.ts`: `FIRST_FRIEND_NOTICE_ID = "first-friend"` in `ACCOUNT_NOTICES`.
- `src/hooks/use-social.ts`: `useFirstFriend()`; `src/components/board/first-friend-line.tsx` (+ View, export in
  `board/index.ts`); `home.tsx`; `social-section.tsx` (empty state, fold note); `profile-card.tsx` (founder line
  under the holds, no button there, as today); `/dev/board` and `/dev/social` gallery entries.
- `src/lib/copy.ts`: keys below. `.env.example`: `BERTH_FOUNDER_USER_ID=`. CONTEXT.md: one line under Friends.
- `db/schema.sql`, idempotent:
  `alter table profiles add column if not exists friends_uncapped boolean not null default false;` and the
  `friends_cap` body (still one line) skipping a side whose profile has `friends_uncapped`. Set David's flag and his
  `share_holdings` with a reviewed one-off (`scripts/founder-setup.ts`, reads the env id). If the env id and the flag
  disagree, the offer is off (fail closed).

## Copy (`firstFriend` group, `Copy` type and object)

- `title`: "Add your first friend"
- `text`: "Friends see each other's rank and, if both of you choose, which stocks and funds you hold. Never amounts."
- `founderName`: "David, who builds Berth"
- `founderSub`: "Accepts every request."
- `add`: "Add David" · `added`: "You and David are friends."
- `shareLink`: "Share your link" · `dismiss`: "Not now"
- `founderHoldsNote` (social group): "David's holdings, shared for comparison, not advice."
- `founderShareHint`: "Turn on your switch to compare holdings with David."

## Tests

- `founder.test.ts` (pure): env parsing, unset means off, offer rules table.
- `social.db.test.ts`: request to the founder makes friends at once, no request row, no email notice; block either
  way and his earlier decline stop it; founder past 50 friends still accepts; asker cap still holds; hidden or staff
  hidden founder means no offer; dismissal and a first friend both close the offer for good.
- No pay: after adding David, no `xp_events` row, no `campaign_claims` row, `referred_by` unchanged, first path
  invite step still open.
- Card and fold: founder card carries `founder` and the note; holds still names only; no Buy rendered (render test).
- Run `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`; `pnpm shot` the strip at /dev/board in webkit.

## Open questions for David

1. Show the strip to established accounts too (any zero friend account), or only to accounts past the first path?
2. Should David appear on new friends' friends board, or be left off it (he would outrank most people on XP)?
3. Which username and avatar does your founder account carry, and may we switch on your holdings sharing now?
