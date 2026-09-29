# A friends board, ranked on capped points, never on money

Replaces ADR-0003 (no leaderboard) for one board only. David decided on
2026-09-28 (docs/plans/social.md, "Confirmed", "Crew is the connection",
"Naming") that Berth gets usernames, a small public card, Salutes and
Friends, and that friends see one board together. ADR-0003's own argument
still holds and is why the board is built the way it is: the XP economy was
left loose "because nobody can win anything by farming it", and a board is
something to win. So the board counts **board points**, not XP:

- XP earned this calendar month (UTC), with order XP (`pour_in` +
  `pour_out`) capped at 300 a month, so the board never ranks how often
  someone trades. Referral XP (`friend_poured` + `invite_accepted`) is
  capped at 250 a month, so it cannot rank how many people someone signs
  up. Every other kind counts in full.
- Plus salute points: Salutes first given this month and not revoked,
  capped at 10. A revoked Salute that is given again keeps its first date,
  so toggling cannot mint a point in a new month.
- Only you and your friends appear, you always. Lifetime XP and rank stay
  what they are on the card. Returns, balances and holdings never rank
  anything and never appear on a card or a board.

There is no harbour-wide board and no all-time board. Anyone reopening
either should reopen this decision with David first.

## What was chosen where the plan left it open

1. Board points capped as above (the plan's recommendation), this month only.
2. The friend link is its own token (`friend_links`, invite-code alphabet,
   12 characters), separate from the referral code and paying no XP. Opening
   it signed in files a friend request; the owner still accepts.
3. Salutes and friend requests need a verified email (`users.email`, set only
   from Privy's verified address). A Salute gives no XP to either side.
4. A friend who hides their card drops off the board and answers "No one by
   that name" to everyone, friends included. They stay in their friends'
   own lists, since those friends already know the name.
5. Picking a username pays no XP. The plan floated 25 XP as a nudge; a name
   is an opt-in to being findable, and paying people to be findable is the
   wrong push.
6. No harbour-wide board.

## Rules this round wrote down

- **Usernames** (`lib/handle`, the one rulebook): lowercase only, stored
  and shown that way, 3 to 20 of `a-z 0-9 _`, no leading or trailing
  underscore, NFKC first; the picker lowercases as you type, so no capital
  I can pose as an l. Uniqueness and lookup use a fold that only turns
  digits into the letters they imitate (`0→o`, `1→l`, `3→e`, `4→a`, `5→s`,
  `7→t`, `8→b`), `rn→m` and `vv→w`, and drops underscores: `harb0_ur` and
  `harbour`, `rnike` and `mike` are one name each, while kai and kal, neil
  and nell stay two. House words, rank names, listing names and tickers are
  reserved as the whole name. Impersonation is judged on words: the name
  is split at underscores and digits, and refused when a token is a house
  word (berth, sodax, support, admin, official, moderator, team, staff,
  robinhood) or a listing's ticker or name, when it starts with a house word
  joined to another or to an official suffix (berthsupport, sodaxhq), starts
  with sodax at all, or ends in support, admin, moderator, official, berth
  or sodax (cybersupport). Steam, teammate, pineapple, badminton, staffy and
  berthold pass. Offensive stems are refused anywhere in the
  name, short words only as a whole segment. A name dropped by a change is
  held 90 days for its last owner (`handle_reserved`, reason `retired`).
  One change per 30 days.
- **Only an account with a verified email picks a username.** Picking one is
  the opt-in to a card; "Hide my card" is one switch, and hidden reads
  exactly like missing. An account whose email is unlinked keeps its
  username, but its card is off (as if hidden) until an email is verified
  again.
- **Friends are mutual, by request.** States: none, sent (cancel), received
  (accept, or decline, which is silent: the sender keeps seeing "sent", and
  a new request to someone who declined within 30 days is filed as declined
  at once). Asking someone who already asked you makes you friends. Both
  sides need a username. At most 50 friends, 20 open requests, and 20 new
  requests a day whatever became of them. Nobody
  sees anyone else's friends or a friend count.
- **Blocks are silent and total**: the pair's friendship, open requests and
  Salutes both ways end, and each answers "No one by that name" to the other.
- **Enumeration**: missing, hidden, blocked and blocking give one identical
  answer. There is no search, no suggestion and no directory. The picker's
  availability check is itself an oracle, so it needs a verified email and
  is rate limited.
- **Rate limits** on every social write and lookup, in the
  `oauth_rate_limits` hour buckets under a `social:` prefix (per account, and
  per address hash for signed-out card views).
- **Reports** take a reason from a fixed list; there is no free text anywhere,
  so the username is the only thing to moderate. A moderator rename is not
  built yet.

## A deviation from the plan

The plan said no public web page at `/u/handle`. This round builds one
because David's brief asked for a page to link to, but it shows a card only
to someone signed in. Every signed out request to `/u/<name>` or
`/f/<token>` gets one fixed answer, "Sign in to see this profile", for every
name, held or not, without a lookup, so a blocked person cannot sign out to
see the card or learn that they are blocked, and nothing about anyone is
public. The page is `noindex` and a shell: the card is asked for from the
browser once the session is known, so no card is in the served HTML.

A block of a name nobody holds is stored like any other, and the blocked
list shows only the name as it was typed, so the list cannot tell a hidden
card from a missing one either.
