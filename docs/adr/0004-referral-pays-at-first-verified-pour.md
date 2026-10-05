# Referral pays at the first verified pour, not at signup

**Status: superseded for the inviter's side on 2026-10-05.**

## Superseded, 2026-10-05 (the inviter's side)

The inviter is no longer paid for a friend's buy. `friend_poured` is retired
and read only: past awards stay in the ledger untouched. The inviter now
earns `friend_stayed` (same 250 XP) when the invited friend has set up their
account (a verified email, a username and a home wallet, the invite
campaign's own definition, `SET_UP_SQL` in `lib/server/campaigns/eligibility`)
and still opened Berth at least six days after setting up, judged a week on, by
the morning run (`lib/server/invite-xp`, table `invite_setups`). A friend
whose inviter was already paid `friend_poured` never pays again. Why: an
invite should reward a friend who stays, not a friend who trades, the same
line the invite campaigns drew; the setup and stay keep it costly enough to
farm (an email, a wallet and a return visit), and the per friend dedup keeps
it to once. The friend's own `invite_accepted` still lands at their first
verified pour, paid to them alone. Nothing is ever given for any action on X.

## Original decision

Industry-default referral programs pay when the invited account is created;
ours pays both sides only when the invited account's first pour verifies
on-chain (xp/pour route: `invite_accepted` to the friend, `friend_poured` to
the referrer, both index-deduped). Accounts are free to mint, pours are not —
paying at signup would make every referral farmable for the cost of an email,
while paying at the pour makes the reward exactly as scarce as a real person
moving real funds. Consequences worth knowing: the referred user's reward is
invisible until they pour (the pantry's thank-you row and the welcome banner
exist to explain the wait), and a referral bound to an account that never
pours simply never pays — that is the design, not a bug.
