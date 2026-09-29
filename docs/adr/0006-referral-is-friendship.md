# A referral that binds makes the two accounts friends

Decided by David on 2026-09-29. Amends ADR-0005's point 2, which kept the
friend link and the referral code apart: they stay two tokens (the friend
link still pays no XP and still files a request), but a referral that binds
now also makes the pair friends, both ways, at once, with no request to
accept. Someone who arrived on your invite is someone you know.

- **When.** Wherever a referral binds: the code pocketed from `/r/CODE` on
  the account's first profile sync, and the code typed by hand in the
  account (the stripped-link hatch). One function,
  `lib/server/social/friends` `befriendOnReferral`, called from
  `lib/server/accounts` `bindReferral` and `claimReferral`.
- **Guards.** A block either way means no friendship, and so does the referrer having declined a request from that account. A full list (50,
  `FRIENDS_MAX`) on either side skips it silently; the friends cap trigger
  still has the last word under a race. The referral itself stands either
  way. A live request between the two is settled as accepted.
- **Audit.** One `social_audit` row, action `friend_referral`, actor the
  referred account, target the referrer, `meta.via` one of `invite`, `code`,
  `backfill`. A pair that was already friends writes none.
- **Merges.** Nothing new: `merge_accounts` already moves friendships to the
  survivor without duplicates. A survivor that was referred by the account
  it absorbs loses that friendship with itself, as it loses the referral.
- **Existing pairs.** `pnpm referral-friends:backfill` applies the same rule
  to referrals bound before this decision. Dry run by default, `--write` to
  save.
- **What the person sees.** Under "A friend invited you": "You and NAME are
  now friends." The name is the referrer's username as a friends list would
  show it. The referrer sees the new friend in their own list.

Binding itself changed the same day: the code now binds on the account's
first sync (the welcome reward not yet paid) rather than only in the request
that created the row, which a wallet sign in often is not.
