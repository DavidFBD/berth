# 0008: The staff area

Status: accepted, 2026-10-01.

Berth needs one place where the operator can see the userbase, the
business, the machinery's health and the paid budgets, and run campaigns,
without becoming a back door into anyone's account. `/staff` is that place.

## Access

- An explicit allowlist of account ids, read from the environment on every
  request: `STAFF_ADMIN_IDS` (admin: reads, reveals, writes) and
  `STAFF_VIEWER_IDS` (viewer: reads only). Not the `@sodax.com` rule, which
  only lets the house's people carry house words in a username. The admin
  list is parsed by `lib/server/staff-auth` (shared with campaigns); the
  viewer list by the same rule in `lib/server/staff-session`.
- One session system for the whole area, campaigns included: its routes'
  `requireStaff`/`requireFreshStaff` (lib/server/staff-auth) read the same
  staff session and never a bare Privy token or a wallet session; the
  campaigns branch's own page pass cookie is gone, and its sign out sweep
  (components/sign-out-sweep, app/api/session/sign-out) now ends the staff
  session. One freshness rule: a code to the account's own email within 15
  minutes (lib/server/privy emailProofAt, over fetchPrivyEmailProofs).
- Sign in is Privy email only: the session door refuses an account with
  no email code on record (a wallet sign in), and wallet sessions never
  open the area. The browser trades its Privy token at
  `POST /api/staff/session` for a session row (`staff_sessions`) and a
  signed cookie that carries only the session id (`__Host-berth-staff`,
  HS256 under `STAFF_SESSION_SECRET`, HttpOnly, SameSite=Strict). Without
  the secret the area does not exist.
- A session lasts as long as the Privy token it came from; staff pages
  renew it from a fresh token every ten minutes, never past twelve hours
  from sign in. A Privy session that can no longer refresh ends it within
  the hour; a Berth sign out ends it at once (the app wide logout
  watcher); "Sign out everywhere" revokes every session of that staff
  member without a deploy. Every request checks the row and the
  allowlist; the role is never read from the cookie. (Taking an id off the
  env list needs a redeploy on Vercel; "Sign out everywhere" does not.)
- To anyone else the area does not exist. A request with neither a staff
  cookie nor a bearer token is rewritten by next.config (beforeFiles) to
  the address Berth has no page for, the same address every unknown path
  is served as (the fallback rewrite), inside Next's own router: status,
  headers, body and RSC requests match an unknown path's exactly. A
  cookie or token that is there but not good is answered by `src/proxy.ts`
  with what that address answers, fetched from the same server (a
  rewrite in the proxy would name itself in a header). Checked by
  `pnpm staff:404-check <url> --rsc` and `pnpm staff:404-diff --url <url>`
  against `next start`. Known limit: a bad cookie or token together with
  an RSC header gets the HTML 404, as Next strips that header before the
  proxy. The campaigns pages and routes stand behind the same door.
- The way back in (2026-10-04). The cookie ends with its Privy token and
  is SameSite=Strict, so a staff member back after an hour, or arriving
  by a link from another site, gets that 404. The 404 page, static and
  the same bytes at every address (kept at the edge like any 404; a
  cookie bearing request is never rewritten to it), carries a door (`lib/staff/door`,
  `components/staff/fresh` StaffDoor): on a /staff address an inline
  script hides its words behind "Loading" before first paint, the door
  asks `POST /api/staff/session` with a fresh Privy token (patiently,
  three tries), and on a yes the page loads again with the cookie and the
  server's gate draws the area. Signed out, not staff, or Privy not ready
  within ten seconds: the 404's words. A mark in sessionStorage stops a
  staff address that really is missing from looping. The door carries no
  staff data and no ids; the area is still drawn only by the server.
  Accepted (review m1): every 404's HTML and script name the /staff path,
  so the 404 tells that a staff area exists, as the public bundle already
  did. It never tells who is staff: no id, role or list reaches a browser.
- Behind the proxy each page calls `staffGate("page")`
  (`lib/server/staff-gate`) first and each route is `staffRoute`, checked
  again with the database. A test reads every file under both trees to
  hold that, method by method.
- Fresh proof: a reveal or a write needs an email code entered in the last
  15 minutes, Privy's `latest_verified_at`, not the access token's `iat`,
  which Privy reissues silently every hour. Stale gets 401 and the page
  offers "Sign in again". (Worth one manual check that Privy never moves
  latest_verified_at without a code.)
- The strict headers (no-store, noindex, no framing, no referrer, nosniff)
  are set by the proxy on authorised responses only, so a refused one
  carries none of them.
- There is no impersonation, no "sign in as", nothing that signs or moves
  money, and no hand edit of a balance or XP. Corrections stay in reviewed,
  audited scripts.

## Data minimisation

- Lists show username, signup date, stage, rank, counts. Emails and wallet
  addresses are masked on the server (`lib/staff/mask`): the email's first
  letter, then a shared webmail domain whole or any other domain by its
  first letter and ending (`d***@gmail.com`, `d***@s****.com`); a wallet's
  first four and last two (`0x12…ab`).
- A full value comes only through `POST /api/staff/reveal`: admin, fresh,
  a reason, the audit row and the read in one statement, at most twenty
  an hour per staff member, and at ten the other admins get an email.
- Search is exact for anything personal (email, wallet, account id) and by
  prefix only for a username. A personal search is sealed (JWE, bound to
  the staff member) before it goes in the address bar, and recorded with
  its kind and the account(s) it found, never the value typed.
- Every view of a person's page is audited before it is read.
- Berth stores no country for an account, so the lists show none.
- `staff_audit` rows are scrubbed of anything shaped like an email or a
  wallet by every writer (`staffAudit` itself) and again on display. Kept
  24 months; the evening run prunes older rows.
- Activity is `users.last_seen_at`, bumped by the profile sync at most once
  a UTC day, or an order, Assistant or AI use; an XP award is not a visit.
  Counted from 1 October 2026 on.
- The privacy policy lists every category staff can see, the masking as it
  is, the audited exact search, every change staff can make, and the log.

## Writes

Only small, reversible ones, each with a reason, each audited: stop email
or lift a stop staff put on (never a bounce or a complaint), hide a shown
profile or show one staff hid (`profiles.staff_hidden_at`; never one the
person hid, and the person's own switch cannot show one staff hid), revoke an AI connection, send a stuck
notice again, mark an account not eligible for campaigns
(`users.campaign_ineligible_at`; the campaigns logic reads it once the
campaigns branch is merged, and until then the button says so), and set a
budget's balance and alert level (every saved balance is a new reading). A one statement write carries its audit
row in that statement (`auditCte`); revoking a grant and resending a notice
cannot, so their row is written first and the outcome second.

## Budgets

Each paid service from its cheapest true source: the Assistant from
`chat_usage` against `CHAT_MONTHLY_BUDGET_USD` (and OpenAI's own bill with
`OPENAI_ADMIN_KEY`), Jev from Berth's own meter (`service_spend`, TypeSafe
has no usage API), X from `x_read_budget` at $0.005 a post (and X's own
count), Resend from `email_sends` against the plan quota. Where no balance
API exists staff enter the balance; remaining is that less what was
metered since, labelled an estimate. Low means at or under the threshold,
or the last week's pace runs it out within seven days (before the monthly
reset). The morning run, last and inside what the run has left, emails
each admin once per service per UTC day, as a security type notice; an
alert left pending past its day is given up, not sent late. Neon and Vercel are not tracked: their usage APIs
are for paid plans.

## Not chosen

- An admin framework or a separate app: one more thing to secure and
  deploy, and Berth's own components already render dense tables.
- Cookie sessions for the whole app: the rest of Berth keeps its bearer
  token model; only the staff area needs server side identity.
- A visit log for retention: Berth keeps none and the staff area does not
  start one; retention reads orders and activity Berth already records.
