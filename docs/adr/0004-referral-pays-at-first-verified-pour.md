# Referral pays at the first verified pour, not at signup

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
