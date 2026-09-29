# Account linking: the "Add an email" failure, and the account model

Investigated 2026-09-28 against `origin/master` at c6e06cb. Read-only: no code
changed, production Neon queried with SELECT only, Privy read through its REST
API (the app config and user lookups).

## Part 1. Diagnosis

### What David saw

He is on desktop Chrome with the Hana extension. His wallet account is
0xbe59…3ca23, level 4, 800 XP. He opened the account drawer, chose "Add an
email to your account", typed an email and pressed Continue. Hana asked him to
sign, he signed, and the drawer then said "That did not go through. Try
again." (`addEmailFailed`, `src/lib/copy.ts:1289`).

### Root cause: `sendCode` is called through a stale closure, so Privy thinks nobody is signed in

`src/hooks/use-link-email.ts`:

- Line 168 takes `sendCode` from Privy's `useLinkEmail()` during the render in
  which the user is **not** signed in to Privy.
- In `submitEmail` (lines 202-237), line 221 `await loginWithSiwe(...)` signs
  in, and line 224 `await sendCode({ email })` runs straight after it, in the
  **same closure**.
- Privy's `sendCode` is a `useCallback` over the Privy `user` taken from
  context. In @privy-io/react-auth 3.35.2 (`dist/esm/index-wGOlH2Wi.mjs`,
  around offset 137500) it does this:

  ```js
  sendCode: h(async ({email}) => {
    if (!t) throw new ae("User must be authenticated before linking an account.",
                         void 0, le.MUST_BE_AUTHENTICATED);   // "must_be_authenticated"
    if (t?.linkedAccounts.some(e => "email" === e.type)) throw ... CANNOT_LINK_MORE_OF_TYPE
    ...
  }, [t, ...])
  ```

  `t` is the `user` from the render the closure came from, which was `null`.
  Once `loginWithSiwe` resolves, React re-renders and builds a new `sendCode`
  that can see the user, but `submitEmail` still holds the old one. That old
  one throws `must_be_authenticated` every time.
- The catch block (lines 226-233) matches neither `linked_to_another_user` nor
  a decline, so it calls `finish({ state: "email", error: "failed" })`. That
  logs out of Privy and shows `addEmailFailed`. Because it logs out, pressing
  Continue again goes back through SIWE and hits the same stale closure. **The
  flow fails every time for any wallet user who does not already have a Privy
  session.** Nothing about Hana, the email, or the account is involved.

`resend` (line 242) is not affected. It runs from a later render, after the
session exists.

### Evidence

| Check | Result |
|---|---|
| Privy user for the wallet (`POST /api/v1/users/wallet/address`) | `did:privy:cmubcgcyh0…`, one linked account (the external wallet, no email). `latest_verified_at` = **2026-09-28T14:57:02Z**. So the SIWE login **succeeded** just now, and the failure happened after it. |
| Vercel logs, `--since 3h --limit 5000` (1,700 lines) | No 4xx, 5xx or error-level entries on any route, and no `/api/siwe/*` calls. Every Privy call is made from the browser straight to Privy, so it never shows up here. One `POST /api/profile 200` at **14:57:03Z**, one second after the SIWE. That is the refetch from `invalidateQueries` in `finish()` (line 184), after the logout. `save()` never ran, so the flow never got past sending the code. |
| Email on a Privy user (`POST /api/v1/users/email/address`) | 404, not linked to any Privy user. `linked_to_another_user` is ruled out, and so is the "taken" state. |
| Email on a Berth `users` row | No row has it. The wallet row (`46b223cd…`, 800 XP, created 2026-09-17) has `privy_did` equal to the Privy user above and `email` null. |
| Privy app config | `wallet_auth: true`, `email_auth: true`, www and apex are both in `allowed_domains`, `merge_accounts_by_email: true`. The configuration does not block SIWE or email linking. |
| The Hana prompt said "on Sonic" | Nothing to worry about. The SIWE message says `eip155:8453` (line 211), Hana shows its active network, and the signature is a plain EIP-191 `personal_sign`. Privy accepted it, as the `latest_verified_at` above shows. |

Side note from the same lookup: row `48ccec2f…` (`retired:did:privy:…`, 25 XP,
created 2026-09-21 14:32:08, two seconds after the Privy user) is the old fork
that the repair path in `accounts.ts:87-140` retired. It is harmless.

### Minimal fix (about 10 lines, in `use-link-email.ts` only)

Call the **latest** `sendCode` once Privy has a user, not the one the closure
captured:

1. Keep refs that update on every render:
   `const sendCodeRef = useRef(sendCode); sendCodeRef.current = sendCode;` and
   `const userRef = useRef(privy.user); userRef.current = privy.user;`.
2. After `await loginWithSiwe(...)`, wait until `userRef.current` is set
   (check every 50 ms, give up after about 5 s and treat it as `failed`), then
   `await sendCodeRef.current({ email })`. Use the ref in `resend` too, for
   consistency.
3. Stop hiding the cause. Add a `privyErrorCode(error)` field to the existing
   `/api/report-error` path (or at least a `console.warn`) so the next
   client-only Privy failure leaves a trace. This one left none on the server.

Another option is to split the step: after SIWE, set `state: "sending"` and
let an effect call `sendCode` when `privy.authenticated && privy.user`
becomes true. The ref version is smaller and keeps the flow in one function.

Test it on production by hand with a fresh wallet: sign, get the code, enter
it, and check that `/api/profile` returns `hasEmail: true` and the email XP is
paid. The server side of the save (`/api/profile/route.ts:57-64`, which calls
`fetchPrivyEmail` then `setEmail`) has never run for real, so this first pass
is also its first real test.

### A privacy problem in the current flow

`addEmailTaken` ("That email already belongs to another account") is shown
when Privy answers `linked_to_another_user`. That happens after the code is
entered, so the person has proved they own the inbox, and the leak is limited.
It is still a dead end with no merge path, and it confirms that the address
has an account. The design below replaces it.

## Part 2. The account model David wants

### Goals

1. Most people have an **account** identified by a verified email.
2. A wallet-first person can add an email later, and the wallet stays the key
   to its own money.
3. A person can attach wallets from other networks (EVM, Solana, Bitcoin, Sui,
   Stellar, …) to the same account.
4. Email privacy: Berth never tells anyone whether an email is registered.
   Nothing links until a one-time code sent to that inbox has been entered.
5. Two existing Berth accounts can be merged safely, idempotently and
   auditably.

### What an account is, and what it is not

The SODAX **hub wallet** is derived from a (chainKey, address) pair
(CONTEXT.md, "Hub wallet"). Money cannot be merged: two wallets keep two hub
wallets, and linking never moves funds. A Berth **account** is the identity
layer above that. It holds XP, rank, referrals, the order ledger, portfolio
history, assistant grants and chat usage. Linking a wallet means "this
wallet's orders and holdings count toward my account", nothing more. The
copy should say this in plain words.

### Identity sources and who proves what

| Identifier | Proof | Who verifies |
|---|---|---|
| Email | A 6-digit code sent to the inbox | Privy's email OTP (already in use). Keep it. Berth has no mail provider (no Resend or Postmark key in `.env.local`), and adding one only for this is optional. |
| EVM wallet | SIWE signature | Berth's own `/api/siwe/nonce` and `/api/siwe/verify` (viem `verifyMessage`, handles ERC-1271 and ERC-6492), which issue a wallet session |
| Solana, Bitcoin, Sui, Stellar, … | A signed message in that chain's format (Sign-In-With-Solana; BIP-322 for Bitcoin; the rest through wallet-sdk-core `signMessage`) | A new family of verifiers behind the same nonce route |
| Privy DID | Privy access token (JWKS) | `verifyPrivyAuth` |

**Principle: Berth's database is the source of truth for which wallets belong
to which account. Privy is used for email login and email OTP only.** Privy
lets an email be linked to only one Privy user and links external wallets
only through its own SIWE. Making Privy the linking graph is what produced
the "borrowed session" scaffolding and three broken versions of this flow.
Wallet proofs stay in Berth's own SIWE (and its equivalents for other
families), and a wallet user never needs a Privy session.

### Database changes

```sql
-- Every wallet an account has proved it controls, on any network.
create table user_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  family text not null check (family in ('evm','solana','bitcoin','sui','stellar','near','icon','injective','stacks')),
  address text not null,          -- canonical form per family (see note)
  proved_at timestamptz not null default now(),
  proof text not null,            -- 'siwe' | 'sign_in_solana' | 'bip322' | 'privy_embedded' | 'legacy'
  primary boolean not null default false,
  unique (family, address)        -- one wallet, one account, ever
);
create unique index user_wallets_one_primary on user_wallets (user_id) where primary;

-- Email proofs owned by Berth, so the rule never depends on Privy's user graph.
alter table users add column email_verified_at timestamptz;
create unique index users_email_unique on users (lower(email)) where email is not null;

-- Every merge, for audit and idempotency.
create table account_merges (
  id uuid primary key default gen_random_uuid(),
  survivor_id uuid not null references users(id),
  absorbed_id uuid not null unique references users(id),  -- a row can be absorbed once
  reason text not null,           -- 'email_code' | 'wallet_proof'
  proof_ref text,                 -- the Privy DID or wallet session that proved it
  moved jsonb not null,           -- per-table row counts
  created_at timestamptz not null default now()
);
alter table users add column merged_into uuid references users(id);
```

**Address canonicalization is a bug to fix before this goes in.**
`normalizeWallet` (`accounts.ts:30-38`) lowercases every address. That is
right for EVM and wrong for Solana base58 and Bitcoin bech32m/base58. For
those it is lossy (the real address cannot be recovered from the stored one)
and could, in principle, collide. Canonicalize per family: EVM lowercase,
Solana case-preserved base58, Bitcoin bech32 lowercased and base58 left as
is, and so on.

`users.wallet_address` stays for one release as a read-through mirror of the
primary EVM wallet. It is then dropped once every reader (`orders`
attribution, `getOrCreateUser`, the rewards route) resolves through
`user_wallets`.

### Migration of existing rows

Production has **6 users** (3 with DID and wallet, 2 wallet-only, 1 retired,
2 with an email, no duplicate emails), so this is a one-transaction backfill:

1. For each `users.wallet_address`, insert `user_wallets(user_id, family,
   address, proof='legacy', primary=true)`. The family is inferred from the
   shape (`0x` + 40 hex → evm, otherwise look it up through Privy or the
   orders' `chain_key`). Skip retired rows.
2. For Privy email users, also insert their embedded EVM and Solana wallets
   from Privy (`proof='privy_embedded'`).
3. Set `email_verified_at = updated_at` where `email is not null` (Privy
   verified those).
4. Create the unique email index last, and check first that there are no
   duplicates (there are none today).

### Resolution rule (replaces `getOrCreateUser`'s branches)

A request carries one or more proofs: a Privy token, which may bring an email,
or a wallet session for a (family, address).

1. Wallet proof: look up `user_wallets (family, address)`. The row found there
   is the account.
2. Privy token: look up `users.privy_did`. If there is none but the token
   carries a verified email, look up `lower(email)`.
3. If both resolve to **different** rows, do not merge silently. Return the
   primary proof's account and a `mergeAvailable` flag that only this caller
   can see. The person confirms the merge in the UI.
4. If nothing resolves, create the account (and the `user_wallets` row).

This removes the "shadowed row repair" (`accounts.ts:87-140`) and the
"incentive path claim" special cases, because a wallet can never be on two
rows.

### Linking flows

**A. Wallet account adds an email** (fixes the current flow):

1. "Add an email" → type the email → **Continue**.
2. Berth checks the wallet session it already holds, so there is no new
   signature. It asks Privy to send a code. The minimal-change route: log in
   to Privy with the email **code** (`useLoginWithEmail`), not SIWE. That
   gives a Privy DID for the email, which the server binds to the wallet's
   account. The borrowed-SIWE scaffolding goes away.
3. Type the code → **Add email**.
4. Server (`POST /api/account/link-email`, with the wallet session header and
   the Privy token): verifies both. If the email or DID belongs to **no**
   account, it attaches them to this one. If it belongs to **another**
   account, the person has now proved control of both, so it offers a merge
   (flow C) instead of an error.
5. Done. The Privy session may stay (it is now this account's email login) or
   be closed. Either is safe, because the account is chosen by
   `user_wallets`, not by the session.

Privacy: step 2 always says "If that address can receive mail, a code is on
its way", whatever happens. Rate limiting (per IP, per wallet, per email
hash) comes from the existing `oauth_rate_limits` pattern. No response before
the code is entered differs by whether the email exists.

**B. Email account attaches another network's wallet**:

1. Account drawer → "Your wallets" → **Add a wallet** → choose a network, and
   the installed wallets are offered (the welcome screen's detection already
   does this).
2. Sign a Berth message in that wallet ("Link this wallet to your Berth
   account. Nonce …"). This is a plain signature, with no gas and no Privy.
3. Server verifies it with the family's verifier. If the wallet is on no
   account, it inserts `user_wallets`. If it is on another account, it offers
   a merge.
4. The wallet shows in the list. Its orders count from now on, and past orders
   are reattributed (the `orders.wallet_address` match).

**C. Merge two accounts**, only after the person has proved control of both:

1. "This wallet already has a Berth account with 800 XP and 3 orders. Bring
   it into this one?" It shows counts, never the other account's email.
2. **Merge** → a server transaction.
3. The result: one account, with the totals shown.

### Merge algorithm (one transaction, idempotent)

The survivor is the account with the verified email. If both have one or
neither does, the older account or the one with more XP survives (to be
decided). Then, inside one `SERIALIZABLE` transaction (or
`select … for update` on both `users` rows, locked in id order to avoid a
deadlock):

1. `insert into account_merges (…, absorbed_id)`. The unique `absorbed_id`
   makes a retry a no-op: on conflict, return the earlier result.
2. `user_wallets`: `update … set user_id = survivor, primary = false`.
3. `orders`: `update … set user_id = survivor`. `intent_tx` is unique, so
   nothing duplicates. `order_marks` follow through `order_id`.
4. `xp_events`:
   - Repeatable kinds (pours, `friend_poured`) move over as they are. The
     `(kind, ref)` and pour-ref unique indexes already stop double counting.
   - Once-per-account kinds (`account_created`, `email_linked`, `avatar_set`,
     …) move only if the survivor does not already have that kind. Otherwise
     the absorbed event is kept on the absorbed row, which leaves the audit
     intact. It is not deleted.
   - Recompute `users.xp = sum(amount)` for the survivor, never by adding the
     two totals together.
5. Referrals:
   - `users.referred_by = absorbed` → `survivor`, for everyone the absorbed
     account invited.
   - The survivor's own `referred_by` is kept. If only the absorbed row had
     one, it is copied over, **unless** that would make the survivor refer
     itself. This is the "bind at creation only" rule, so decide whether a
     merge counts as creation (open decision).
   - The absorbed account's `referral_code` stays reserved, and it resolves to
     the survivor so old links still work (`referral_redirect`, or keep the
     row and follow `merged_into`).
6. `portfolio_days` (primary key `(user_id, day)`): **do not add the rows
   together.** Delete the survivor's days from the earliest affected day
   onward, and let the evening cron rebuild them from the combined order
   ledger (`source='ledger'`). Snapshot days of the absorbed account that the
   ledger cannot explain are kept in a side table, or dropped with a note.
7. `oauth_grants` and `oauth_tokens`: revoke the absorbed account's grants.
   Do not move them, because an assistant granted to one identity should not
   silently get another. The person reconnects.
8. `chat_usage`, `mcp_calls`: move them (they are quota and cost history).
9. Absorbed row: `merged_into = survivor`, `privy_did = 'merged:' || did`,
   `wallet_address = null`, `email = null`. The row is kept, never deleted, as
   the retired-row precedent does.
10. Recompute the rank, and fire one "accounts merged" toast. No new XP is
    paid for merging.

Every step is a set update keyed by the absorbed id, so running it again
after a crash (without the `account_merges` row, because the transaction
rolled back) does the same work once.

### UI in the account drawer (four steps a person sees)

1. **Your account**: email (or "Add an email"), then "Your wallets" listed by
   network with short addresses, and **Add a wallet**.
2. **Prove it**: a code for an email, a signature for a wallet. It always
   says what the signature is for before asking.
3. **If it is already on another account**, after proof only: counts and a
   plain **Bring it in** or **Keep separate**.
4. **Done**: one line saying what changed, with the XP total.

The copy follows the house rules: in `copy.ts`, no dashes, no emoji. For
example: "Your wallet stays the key to its own money. Linking only puts its
orders on this account."

### Risks

- **Account takeover by linking.** A stolen email session could attach the
  attacker's wallet. That matters little (it adds, it does not take), but a
  merge moves XP and referral credit. So a merge needs a **fresh** proof of
  both sides (under 10 minutes old), not just a lingering session. Both
  accounts get a notice email once there is a mail channel.
- **Money confusion.** People may expect their balances to combine. Holdings
  per wallet stay separate on the hub, and the portfolio view must say "across
  your wallets" and add values, not holdings.
- **Privy state drift.** A Privy user can still hold an external wallet that
  Berth has put on another account. Berth ignores Privy's wallet list for
  identity and uses it only to find embedded wallets.
- **`portfolio_days` rebuild** changes history charts after a merge. That is
  expected, so say so in the confirmation.
- **Solana and Bitcoin lowercasing** (above) must be fixed before any
  non-EVM `user_wallets` row is written, or proofs will not match stored
  rows.
- **Enumeration by timing or rate limits.** The "code sent" response must be
  identical, sent at a constant or queued pace, and not faster when the email
  is unknown.

### Open decisions for David

1. Keep Privy for the email OTP (no new vendor) or add Resend for
   Berth-owned codes and merge notices. The recommendation: Privy now, Resend
   when notices are needed.
2. Which account survives a merge when both have an email or neither does
   (the older one, or the one with more XP).
3. Whether a merge may bring over a `referred_by` that the survivor lacks.
4. Whether to keep the Privy email session after a wallet user adds an email
   (it becomes a second way in) or close it as today.
5. Which non-EVM families to support first (Solana and Bitcoin suggested) and
   whether to verify BIP-322 in-house.
6. Whether an account may unlink a wallet, and whether its orders then leave
   with it.

## Addendum (2026-09-28): several wallets on the same network

David's point: browser extensions overlap. One extension may serve EVM + Solana, another EVM + Bitcoin, so one account can end up with two or more addresses on the same network family.

Principles:
- **An address is the identity unit, not the extension.** An extension is only a signer. `user_wallets(family, address)` allows many rows per family per account; each address belongs to one account only.
- **One home address per account.** Berth's hub account on Sonic is derived from an EVM address, so every linked EVM address has its own hub wallet. Without a rule, holdings split across hub wallets. The account keeps exactly one `home` EVM address: buys land in its hub wallet. Other EVM addresses are pay-from only.
- **Totals sum every hub wallet.** If a second EVM address already holds Berth listings in its own hub wallet (it traded before it was linked), the account total, What you own, performance and the assistant tools must sum across all linked hub wallets, and a sell asks which hub wallet it comes from (or offers to move it home, one signature).
- **Connected is not linked.** On each visit the UI compares the connected addresses per family with the linked ones:
  - connected + linked: normal.
  - connected + not linked, family already has a linked address: a quiet prompt "This wallet isn't part of your account. Add it?" (prove with a signature), never automatic.
  - connected + linked to a different account: say only "This wallet belongs to another Berth account" after its signature proves ownership; offer the merge flow, same privacy rule as email.
  - linked but not connected: fine; pay-from lists show only connected ones, holdings still count.
- **Pay-from picker groups by family then address**, labelled by the extension that provided it and a short address, so two EVM addresses are distinguishable.
- **Receive addresses** show the home address per family only.
- **Unlinking** the home address requires choosing a new home first; unlinking an address with holdings in its hub wallet is blocked until those are moved or the user confirms they stay reachable only by reconnecting that wallet.

Open decisions: whether a second EVM address may ever become home (switching home moves future buys only); whether to auto-offer "move holdings home" when a linked address has a separate hub wallet.

## Decisions (David, 2026-09-28): adopted as recommended

- Berth owns the account; identifiers attach to it: verified emails (one primary) and wallet addresses as CAIP-10 (`eip155:`, `solana:`, `bip122:`). Privy is used for email OTP and embedded wallets only, never as the ownership record.
- Wallet proof: SIWE (EIP-4361), SIWS (Solana), BIP-322 (Bitcoin), verified server-side.
- One home EVM address per account (buys land there); others pay-from; totals sum all linked hub wallets.
- Email codes: Privy. Security notices via Resend later (phase 5).
- Merge survivor: the account with a verified email; if both or neither, the older. Absorbed account's referred_by is dropped.
- Networks after EVM: Solana, then Bitcoin.
- Unlink: orders stay on the account as history; the address may join another account only after a 7-day cooldown.
- Home switch allowed with confirmation, future buys only. "Move holdings home" offered, never automatic.
- Everywhere: uniform responses before proof; fresh proof of both sides for link/unlink/merge; audit log; merges one idempotent transaction, absorbed sessions and OAuth grants revoked; rate limits; per-network address normalisation.

Build order: (1) normalisation fix + identifiers table + migrate existing users, no visible change; (2) second EVM wallet, home address, aggregated totals; (3) email merge flow; (4) Solana, Bitcoin; (5) security notice emails.
