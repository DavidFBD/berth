-- LSTeaTime accounts + rewards ledger. Idempotent: safe to re-run.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  -- Identity is either of these (or both after linking). Wallet addresses
  -- are stored lowercased.
  privy_did text unique,
  wallet_address text unique,
  email text,
  avatar_id text,
  -- Denormalized total for cheap reads; xp_events is the source of truth.
  xp integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_identity check (privy_did is not null or wallet_address is not null)
);

create table if not exists xp_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  amount integer not null,
  -- Dedup handle for repeatable kinds (the intent's hub tx hash for pours).
  -- Null for once-per-account kinds.
  ref text,
  created_at timestamptz not null default now()
);

-- A pour's tx hash can be claimed once, ever, by anyone.
create unique index if not exists xp_events_kind_ref_unique
  on xp_events (kind, ref) where ref is not null;

-- …and once ACROSS directions too: without this, the same hash could pay
-- pour_in to one account and pour_out to another (kind differs, so the
-- index above alone permits it).
create unique index if not exists xp_events_pour_ref_unique
  on xp_events (ref) where kind in ('pour_in', 'pour_out');

-- Once-per-account kinds (account_created, email_linked, avatar_set, username_set).
create unique index if not exists xp_events_once_per_user
  on xp_events (user_id, kind) where ref is null;

create index if not exists xp_events_user_idx on xp_events (user_id, created_at desc);

-- Referrals: every account gets a short shareable code (minted lazily on
-- profile sync); referred_by binds once, at account creation only, so an
-- existing account can never be retro-claimed by a link click.
alter table users add column if not exists referral_code text;
alter table users add column if not exists referred_by uuid references users(id);

create unique index if not exists users_referral_code_unique
  on users (referral_code) where referral_code is not null;

-- A reward can land on a row from someone ELSE's request (friend_poured is
-- written during the friend's pour). announced=false parks the news until
-- the owner's next profile sync, which flips it and toasts the ceremony.
alter table xp_events add column if not exists announced boolean not null default true;

-- One row per invite-link landing (the /r/CODE page beacons it), so a
-- referrer can see taps next to seats. Uncounted, unauthenticated, unpaid:
-- purely funnel telemetry.
create table if not exists referral_clicks (
  id bigint generated always as identity primary key,
  code text not null,
  created_at timestamptz not null default now()
);

create index if not exists referral_clicks_code_idx on referral_clicks (code);

-- One row per filled order, written when the fill is verified (and backfilled
-- once from xp_events refs). What the ledger never kept: which listing, how
-- much of it, what it cost. Performance and "since your first buy" read here.
-- Amounts are decimal units, not raw integers. `usd_value` is exact for a
-- stablecoin and priced at the order's minute otherwise; `usd_source` says
-- which ('stable' or 'price'), and both stay null when neither is known.
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  wallet_address text,
  intent_tx text not null unique,
  fill_tx text,
  direction text not null check (direction in ('buy', 'sell')),
  listing_symbol text not null,
  listing_address text not null,
  quantity numeric,
  min_quantity numeric,
  pay_symbol text,
  pay_chain text,
  pay_amount numeric,
  fee_amount numeric,
  usd_value numeric,
  placed_at timestamptz,
  filled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table orders add column if not exists usd_source text;

-- The intent's source address as given, for every buy and sell
-- (lib/orders readOrder): wallet_address keeps only an EVM payer, so a
-- buy paid from Solana or Bitcoin named nobody. Campaigns read it for one
-- per wallet and the shared payer signal (lib/server/campaigns).
alter table orders add column if not exists src_address text;

create index if not exists orders_user_idx on orders (user_id, placed_at);
create index if not exists orders_wallet_idx on orders (wallet_address, placed_at);

-- The thirty day hold check (lib/server/holds): a buy still on the books a
-- month later earns held_30_days, once. hold_checked_at stamps the verdict
-- so a buy is judged once; hold_outcome says which ('paid' or 'forfeit').
-- A read that failed leaves both null and the next daily run tries again.
alter table orders add column if not exists hold_checked_at timestamptz;
alter table orders add column if not exists hold_outcome text
  check (hold_outcome in ('paid', 'forfeit'));

-- Where the buy was actually delivered: intent.dstAddress, the wallet the
-- fill's Transfer went to (lib/server/orders), lowercased. The hold check
-- reads the balance there and nowhere else; a buy without it is not judged.
alter table orders add column if not exists delivered_to text;

-- The last hold check that could not reach a verdict (a failed read). The
-- cron walks never-tried rows first, so one row that always fails cannot
-- starve the ones behind it.
alter table orders add column if not exists hold_attempted_at timestamptz;

-- The cron's candidate query filters unchecked buys by the same effective
-- date expression it indexes here; the partial index keeps that a short
-- range scan however long the order book grows.
create index if not exists orders_hold_due_idx
  on orders ((coalesce(filled_at, placed_at, created_at)))
  where direction = 'buy' and hold_checked_at is null;

-- Most bought on Berth this week (lib/server/social-proof) reads the last
-- seven days of buys by the same effective date; this keeps it a short
-- range scan. Only an index: nothing reads or writes a new column.
create index if not exists orders_buys_recent_idx
  on orders ((coalesce(filled_at, placed_at, created_at)))
  where direction = 'buy';

-- Limit orders (lib/limit-orders, lib/server/limit-orders), behind the
-- LIMIT_ORDERS_USERS switch. A limit order is an intent that waits in the
-- hub Intents contract until a solver fills it at the price or better, or
-- its owner cancels it. While it waits it lives only here, never in
-- `orders`, so no holding, performance, hold check or benchmark reader
-- can count money that has not bought anything. When it fills, the fill
-- is written to `orders` like any other, marked order_type 'limit' with
-- the price it was placed at.
alter table orders add column if not exists order_type text not null default 'market'
  check (order_type in ('market', 'limit'));
alter table orders add column if not exists limit_price numeric;

-- One row per limit order placed. Amounts are raw integers in the token's
-- smallest units (input_decimals, output_decimals say which), read from
-- the intent on chain, never from the client: `input_raw` is what the
-- solver receives (after the partner fee), `min_output_raw` the least it
-- may pay. `limit_price` is the dollar price the person named.
-- `expires_at` is the intent's own deadline, null for until cancelled.
-- `status` follows the backend's record of the intent (resting, partial,
-- filled, cancelled, expired); `cancel_asked_at` is when the person asked
-- to cancel, so a cancel after the deadline reads as theirs. `announced_at`
-- is when the page last told the person about a fill it found.
create table if not exists limit_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  intent_tx text not null unique,
  intent_hash text,
  direction text not null check (direction in ('buy', 'sell')),
  listing_symbol text not null,
  listing_address text not null,
  pay_symbol text,
  pay_chain text,
  src_chain text,
  input_raw numeric not null,
  input_decimals int not null,
  min_output_raw numeric not null,
  output_decimals int not null,
  limit_price numeric not null check (limit_price > 0),
  expires_at timestamptz,
  status text not null default 'resting'
    check (status in ('resting', 'partial', 'filled', 'cancelled', 'expired')),
  remaining_raw numeric,
  received_raw numeric,
  fill_tx text,
  close_tx text,
  cancel_asked_at timestamptz,
  announced_at timestamptz,
  checked_at timestamptz,
  placed_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

-- `fill_recorded_at`: when a fill was written into `orders`; a filled row
-- without it is retried by the next sync. `cancel_tx`: the cancel the
-- person signed, the only thing that sets cancel_asked_at.
alter table limit_orders add column if not exists fill_recorded_at timestamptz;
alter table limit_orders add column if not exists cancel_tx text;

create index if not exists limit_orders_user_idx on limit_orders (user_id, placed_at desc);
create index if not exists limit_orders_waiting_idx
  on limit_orders (checked_at nulls first) where status in ('resting', 'partial');

-- A pour whose fill could not be confirmed when the client asked for its
-- XP (lib/server/pour-claims): the backend had not indexed it yet, or it
-- is a limit order still waiting. XP is only ever paid for a filled
-- order, so the claim waits here and the evening pass pays it once it
-- fills, or drops it when it closed unfilled. `outcome` is 'paid' or
-- 'dropped' once settled.
create table if not exists pour_claims (
  intent_tx text primary key,
  user_id uuid not null references users(id) on delete cascade,
  direction text not null check (direction in ('buy', 'sell')),
  fill_tx text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  outcome text check (outcome in ('paid', 'dropped'))
);

create index if not exists pour_claims_open_idx on pour_claims (created_at) where settled_at is null;

-- When the evening pass last looked at an open claim without settling it:
-- it takes the least recently looked at first, so a stuck one rotates.
alter table pour_claims add column if not exists last_checked_at timestamptz;

-- false: kept while the ownership proof could not be read (an RPC error, a
-- timeout; lib/server/pour-ownership). The evening pass proves it, and a
-- proven claim from another account takes it over, so a report made while
-- the chain did not answer never stands in the owner's way.
alter table pour_claims add column if not exists proven boolean not null default true;

-- Several accounts may hold an unproven claim on one intent at once, so a
-- stranger's report made while the chain did not answer never stands in
-- the owner's: one row per (intent, account), at most one proven claim and
-- at most one claim per intent settled as recorded. The evening pass proves each; the
-- one that proves settles and the others are dropped (lib/server/pour-claims).
-- (Statements inside the block lead with their semicolons, as in
-- merge_accounts, so scripts/db-push.mjs keeps the block whole.)
do $$ begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'pour_claims'::regclass and conname = 'pour_claims_pkey' and array_length(conkey, 1) = 1
  ) then
    alter table pour_claims drop constraint pour_claims_pkey
    ; alter table pour_claims add constraint pour_claims_pkey primary key (intent_tx, user_id)
  ; end if
; end $$;
create unique index if not exists pour_claims_one_proven on pour_claims (intent_tx) where proven;
create unique index if not exists pour_claims_one_settled on pour_claims (intent_tx) where outcome in ('paid', 'recorded_no_xp');

-- Buys that pay nothing, keyed by intent (lib/server/no-xp): a buy reported
-- from where Berth is not available (lib/availability). The ledger stays
-- true (the order row, its marks, the recurring run it answers), but no XP
-- is paid and no hold is judged, on every path: the pour route from any
-- country, the evening pass over claims, a limit fill, the hold check.
-- Written once, never removed.
create table if not exists no_xp_intents (
  intent_tx text primary key,
  created_at timestamptz not null default now()
);

-- Why it pays nothing: 'unavailable', reported from where Berth is not
-- available; or 'unproven_source', a buy delivered to the account's own hub
-- wallet whose payer cannot be proven the account's (a Sui or Stellar
-- source, which no identity can be linked in; lib/server/pour-ownership).
alter table no_xp_intents add column if not exists reason text not null default 'unavailable';
alter table no_xp_intents drop constraint if exists no_xp_intents_reason_check;
alter table no_xp_intents add constraint no_xp_intents_reason_check
  check (reason in ('unavailable', 'unproven_source'));

-- A claim settled for such a buy says so: recorded, nothing paid.
alter table pour_claims drop constraint if exists pour_claims_outcome_check;
alter table pour_claims add constraint pour_claims_outcome_check
  check (outcome in ('paid', 'dropped', 'recorded_no_xp'));

-- The listing a claim buys or sells, read from the intent when the claim is
-- kept (the pour route). An open buy claim holds back a recurring run of
-- the same listing (lib/server/recurring): the strip and the reminder do not
-- offer it and it is not let go until the evening pass settles the claim.
-- Null on claims kept before this column; those hold back nothing.
alter table pour_claims add column if not exists listing_symbol text;

-- Daily closes per listing and benchmark (lib/marks), kept past DefiLlama's
-- ninety day reach so a portfolio can be drawn for as long as it existed.
-- One row per market day, taken at 21:30 UTC, after the New York close;
-- written by /api/cron/evening and `pnpm marks:backfill`. A day the despike
-- rejected has no row; a missing mark stays missing.
create table if not exists marks (
  symbol text not null,
  day date not null,
  close numeric not null check (close > 0),
  source text not null default 'defillama',
  created_at timestamptz not null default now(),
  primary key (symbol, day)
);

-- An account's value at each day's close (lib/portfolio-days). 'snapshot'
-- rows come from the balances read on chain by /api/cron/evening, so
-- a transfer the orders never saw is still counted; 'ledger' rows are past
-- days rebuilt from the orders by `pnpm portfolio:backfill`, only for an
-- account whose balance the orders fully explain, and the days between the
-- first buy and the first snapshot by `pnpm history:backfill` and the
-- evening cron, only when the orders explain that snapshot
-- (lib/server/history-backfill). `holdings` is
-- [{symbol, quantity, price, source}], source 'mark', 'oracle' or
-- 'prior_mark' (the day's mark was taken out after, lib/server/marks). `as_of`
-- is when the holdings were read (a ledger day: its close).
create table if not exists portfolio_days (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  value_usd numeric not null check (value_usd >= 0),
  holdings jsonb not null default '[]'::jsonb,
  source text not null check (source in ('snapshot', 'ledger')),
  as_of timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Each benchmark's price at an order's minute (lib/portfolio-history,
-- lib/benchmark), so the benchmark is bought when the order was rather
-- than at the close before it, which would hand it a session (a weekend,
-- for Gold and Bitcoin) the order never lived through. Written at fill
-- time by the pour route, filled in by /api/cron/evening for any order still
-- missing one, and by `pnpm order-marks:backfill`. `priced_at` is the
-- moment of DefiLlama's price, which may sit a few minutes from the order.
create table if not exists order_marks (
  order_id uuid not null references orders(id) on delete cascade,
  symbol text not null,
  price numeric not null check (price > 0),
  priced_at timestamptz,
  source text not null default 'defillama',
  created_at timestamptz not null default now(),
  primary key (order_id, symbol)
);

-- Agent access (lib/server/oauth): Berth's own OAuth authorization server,
-- so an assistant (Claude, ChatGPT, Grok) can read an account and draft
-- orders through the MCP server at /mcp. The assistant never signs: a draft
-- is a link the person opens, approves and signs in Berth. Every secret is
-- an opaque random value stored only as its SHA-256 hash (hex).

-- A registered client: 'dcr' rows come from POST /oauth/register (RFC 7591,
-- public clients only); 'cimd' rows cache a Client ID Metadata Document,
-- where client_id is the https URL the document lives at.
create table if not exists oauth_clients (
  client_id text primary key,
  kind text not null check (kind in ('dcr', 'cimd')),
  name text,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

alter table oauth_clients add column if not exists fetched_at timestamptz;

-- One authorization code, single use, a couple of minutes long. PKCE S256
-- only; `resource` is the RFC 8707 resource it was asked for, if any.
create table if not exists oauth_codes (
  code_hash text primary key,
  client_id text not null,
  user_id uuid not null references users(id) on delete cascade,
  grant_id uuid,
  redirect_uri text not null,
  code_challenge text not null,
  scope text not null,
  resource text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Set when a used code is presented again. The exchange that links the code
-- to its grant reads it in the same statement, so a replay racing the first
-- exchange still revokes what that exchange made.
alter table oauth_codes add column if not exists replayed_at timestamptz;

-- Whether the authorization request named its redirect_uri. Only then must
-- the token request repeat it (RFC 6749 section 4.1.3).
alter table oauth_codes add column if not exists redirect_uri_sent boolean not null default true;

-- What a person allowed one client to do. Revoking it revokes every token
-- minted under it; the account drawer lists the live ones.
create table if not exists oauth_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_id text not null,
  client_name text,
  scope text not null,
  resource text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists oauth_grants_user_idx on oauth_grants (user_id) where revoked_at is null;

-- Access and refresh tokens. A refresh token is rotated on every use:
-- replaced_by points at its successor, and presenting a rotated one again
-- is taken as theft and revokes the whole grant.
create table if not exists oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references oauth_grants(id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by text,
  created_at timestamptz not null default now()
);

create index if not exists oauth_tokens_grant_idx on oauth_tokens (grant_id);

-- What this token may do: the grant's scope, or less when a refresh asked
-- to narrow it. Null reads as the grant's.
alter table oauth_tokens add column if not exists scope text;

-- Fixed hour windows for the authorization server's rate limits
-- (lib/server/oauth/rate-limit): registrations per caller and in all,
-- metadata document fetches per caller. One row per bucket and hour,
-- counted up by an upsert, so two racing requests can never both take the
-- last place. The evening cron prunes old windows.
create table if not exists oauth_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  n integer not null default 0,
  primary key (bucket, window_start)
);

-- One row per MCP tool call (lib/server/mcp/usage), written after the
-- answer is sent. Which tool, for whom, through which assistant, whether it
-- worked and how long it took. Never the arguments or the output. The
-- evening cron deletes rows older than 90 days.
create table if not exists mcp_calls (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  grant_id uuid not null,
  assistant text,
  tool text not null,
  ok boolean not null,
  error text,
  duration_ms integer not null,
  created_at timestamptz not null default now()
);

create index if not exists mcp_calls_created_idx on mcp_calls (created_at);
create index if not exists mcp_calls_user_idx on mcp_calls (user_id, created_at);

-- One row per message to the in-app assistant (lib/server/chat/usage),
-- written when the message ends. Who, which model, how many steps, which
-- tools by name, the tokens and the cost in USD millionths, whether it
-- worked (a short code when not) and how long it took. Never what was
-- said: no message text, no tool arguments, no tool output. The day and
-- month cost sums read it (the caps and CHAT_MONTHLY_BUDGET_USD); the
-- evening cron deletes rows older than 90 days.
create table if not exists chat_usage (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  provider text not null,
  model text not null,
  steps smallint not null,
  tools text[] not null default '{}',
  input_tokens integer not null,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  output_tokens integer not null,
  reasoning_tokens integer not null default 0,
  cost_micros integer not null,
  ok boolean not null,
  error text,
  duration_ms integer not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_usage_user_idx on chat_usage (user_id, created_at);
create index if not exists chat_usage_created_idx on chat_usage (created_at);

-- The identifiers that belong to an account (docs/plans/account-linking.md,
-- phase 1). An account is the users row; every verified email and every
-- wallet address it has proved attaches here, one row each. `value` is the
-- normalised identifier: a trimmed, lowercased email, or a chain-agnostic
-- CAIP-10 wallet id (`eip155:<lowercase hex>`, `solana:<base58 as signed>`,
-- `bip122:<bech32 lowercase | base58 as given>`, see lib/identity/caip).
-- unique (kind, value): an identifier belongs to one account, ever. One
-- primary email and one home EVM address (where buys land) per account.
-- Phase 1 only dual writes here; reads still come from users.email and
-- users.wallet_address, which stay as they are.
create table if not exists user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('email', 'wallet')),
  value text not null,
  family text check (family in ('evm', 'solana', 'bitcoin')),
  is_primary boolean not null default false,
  is_home boolean not null default false,
  -- When Berth accepted a proof in a live request (the Privy email code,
  -- a SIWE session, Privy's record of the wallet). Null for 'legacy' rows
  -- carried over by the backfill: proved once, time unknown.
  verified_at timestamptz,
  -- How it was proved: the Privy email code, a signature (SIWE, SIWS,
  -- BIP-322), Privy's own record of the account's wallet, or carried over
  -- from the users row by the backfill.
  proof text not null check (proof in ('privy_email', 'siwe', 'siws', 'bip322', 'privy_wallet', 'legacy')),
  created_at timestamptz not null default now(),
  constraint user_identities_kind_value unique (kind, value),
  constraint user_identities_family_shape check (
    (kind = 'email' and family is null) or (kind = 'wallet' and family is not null)
  ),
  constraint user_identities_primary_is_email check (not is_primary or kind = 'email'),
  constraint user_identities_home_is_evm check (not is_home or family = 'evm')
);

create unique index if not exists user_identities_one_primary_email
  on user_identities (user_id) where is_primary;

create unique index if not exists user_identities_one_home_evm
  on user_identities (user_id) where is_home;

create index if not exists user_identities_user_idx on user_identities (user_id);

-- Phase 2 (docs/plans/account-linking.md): an account may hold several
-- wallets. Unlinking keeps the row, with unlinked_at set, so the address
-- still belongs to nobody else for seven days (lib/server/identities
-- UNLINK_COOLDOWN_DAYS); after that the next account to prove it takes the
-- row over. Every read of "the account's wallets" skips unlinked rows.
alter table user_identities add column if not exists unlinked_at timestamptz;

-- An unlinked row is never the home: the one-home index counts linked rows only.
alter table user_identities drop constraint if exists user_identities_unlinked_not_home;
alter table user_identities add constraint user_identities_unlinked_not_home
  check (unlinked_at is null or not is_home);

-- What happened to an account and why, for the linking, unlinking and merge
-- phases that follow. `detail` never holds a secret: no token, no code, no
-- signature.
create table if not exists account_audit (
  id bigint generated always as identity primary key,
  user_id uuid references users(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_audit_user_idx on account_audit (user_id, created_at desc);

-- Every nonce an account wallet act spent (lib/server/account-wallets-route):
-- a proof is accepted once, never replayed inside its ten minutes. The
-- evening prune deletes rows older than a day (the token itself is dead
-- after ten minutes, so an old row guards nothing).
create table if not exists account_nonces (
  nonce text primary key,
  user_id uuid references users(id) on delete cascade,
  act text not null,
  spent_at timestamptz not null default now()
);

-- Social, phase 1 (docs/plans/social.md, ADR-0005): usernames, the public
-- card, Salutes, friends, blocks, reports. Nothing here holds money, a
-- wallet or a holding; the card never shows one. lib/server/social owns
-- every read and write.

-- One username per account. `handle` is as typed, for display;
-- `handle_norm` is the fold from lib/handle (lowercase, 0→o, 1→l, 5→s,
-- underscores dropped), and uniqueness is on it, so lookalikes collide.
create table if not exists handles (
  user_id uuid primary key references users(id) on delete cascade,
  handle text not null,
  handle_norm text not null,
  created_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  constraint handles_norm_unique unique (handle_norm)
);

-- Names nobody may take. The fixed lists (house words, ranks, listings,
-- offensive words) live in lib/handle; this table holds what changes: a
-- name dropped by a change, held 90 days for its last owner (`user_id`),
-- and anything a moderator adds. `until` null means forever.
create table if not exists handle_reserved (
  handle_norm text primary key,
  reason text not null check (reason in ('house', 'rank', 'listing', 'offensive', 'retired')),
  user_id uuid references users(id) on delete set null,
  until timestamptz,
  created_at timestamptz not null default now()
);

-- Whether the card can be found. A row exists once a username is picked;
-- no row, no card. The performance line columns wait for phase 3.
create table if not exists profiles (
  user_id uuid primary key references users(id) on delete cascade,
  visible boolean not null default true,
  hidden_at timestamptz,
  -- The username when the card was hidden: all a friend's list shows of a
  -- hidden friend, so a rename while hidden stays unseen.
  hidden_handle text,
  perf_line boolean not null default false,
  perf_benchmark text,
  updated_at timestamptz not null default now()
);

-- "Show my face, name and rank on links I share": off unless the owner turns
-- it on. Only then do the link previews of /u/<username> and of their invite
-- link name them (lib/server/og-people); off, each is the anonymous card
-- every unknown name or code gets.
alter table profiles add column if not exists link_face boolean not null default false;

-- "Let my friends see which stocks and funds I hold": off unless the owner
-- turns it on (lib/server/social-proof). Only then is this account counted
-- or named in a friend's "Your friends hold" list or on its card shown to a
-- friend, and only an account with it on sees its friends' (each sees the
-- others' only by sharing their own). Never an amount, in either direction.
alter table profiles add column if not exists share_holdings boolean not null default false;

-- One Salute per giver per card. Revoking sets revoked_at; saluting again
-- clears it and keeps first_at, so toggling cannot mint a new salute point
-- in a new month (ADR-0005).
create table if not exists salutes (
  giver_id uuid not null references users(id) on delete cascade,
  recipient_id uuid not null references users(id) on delete cascade,
  first_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (giver_id, recipient_id),
  constraint salutes_not_self check (giver_id <> recipient_id)
);

create index if not exists salutes_recipient_idx on salutes (recipient_id, first_at) where revoked_at is null;

-- Friend requests. 'declined' stays live for its sender, who keeps seeing
-- "sent" (a decline is silent); cancelling makes it 'withdrawn'. At most
-- one live request per direction.
create table if not exists friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references users(id) on delete cascade,
  to_id uuid not null references users(id) on delete cascade,
  via text not null default 'handle' check (via in ('handle', 'link')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_not_self check (from_id <> to_id)
);

create unique index if not exists friend_requests_live_unique
  on friend_requests (from_id, to_id) where status in ('pending', 'declined');
create index if not exists friend_requests_to_idx on friend_requests (to_id) where status = 'pending';

-- Friends, one row per pair with a_id < b_id.
create table if not exists friends (
  a_id uuid not null references users(id) on delete cascade,
  b_id uuid not null references users(id) on delete cascade,
  since timestamptz not null default now(),
  primary key (a_id, b_id),
  constraint friends_ordered check (a_id < b_id)
);

create index if not exists friends_b_idx on friends (b_id);

-- The 50 friend cap, held by the database itself (lib/server/social/friends
-- FRIENDS_MAX). After each new pair the trigger takes an advisory lock per
-- account, in uuid order, then counts: a racing insert for the same person
-- waits for the lock and, counting afresh, sees the other's row, so two
-- accepts at once cannot take anyone past 50. The body sits on one line
-- because db:push splits statements at a semicolon that ends a line. An
-- account merge (merge_accounts, below) sets berth.merging for its own
-- transaction and skips the cap: two people's friends become one person's
-- and none is dropped to fit; the cap then only stops new ones.
create or replace function friends_cap() returns trigger language plpgsql as $$
begin if coalesce(current_setting('berth.merging', true), '') = 'on' then return null; end if; perform pg_advisory_xact_lock(hashtextextended('friends:' || new.a_id::text, 0)); perform pg_advisory_xact_lock(hashtextextended('friends:' || new.b_id::text, 0)); if (select count(*) from friends where a_id = new.a_id or b_id = new.a_id) > 50 or (select count(*) from friends where a_id = new.b_id or b_id = new.b_id) > 50 then raise exception 'friends cap reached' using errcode = 'check_violation'; end if; return null; end $$;

drop trigger if exists friends_cap on friends;

create trigger friends_cap after insert on friends for each row execute function friends_cap();

-- A card is off while its account has no verified email (lib/server/social
-- SHOWN_SQL). When the email goes, the username at that moment is kept as
-- `hidden_handle`, as the hide switch does, so friends' lists keep showing
-- that name and nothing newer; when an email comes back to a card whose
-- switch is on, the stored name is cleared. Held here rather than in the
-- code that unlinks, so every way an email is removed does it. One line
-- body, for db:push's split.
create or replace function social_email_change() returns trigger language plpgsql as $$
begin if new.email is null and old.email is not null then update profiles p set hidden_handle = coalesce(p.hidden_handle, (select h.handle from handles h where h.user_id = new.id)), updated_at = now() where p.user_id = new.id; elsif new.email is not null and old.email is null then update profiles p set hidden_handle = null, updated_at = now() where p.user_id = new.id and p.visible; end if; return new; end $$;

drop trigger if exists social_email_change on users;

create trigger social_email_change after update of email on users for each row execute function social_email_change();

-- A friend link: its own unguessable token, not the referral code, and
-- paying no XP. One live link per account; a new one revokes the old.
create table if not exists friend_links (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index if not exists friend_links_one_live
  on friend_links (user_id) where revoked_at is null;

-- Blocks: silent and total (lib/server/social/blocks). `handle_snapshot`
-- is the name exactly as the blocker typed it, and the only thing the
-- blocker's list ever shows; `handle_norm` is its fold. A name that belongs
-- to nobody still gets a row, with `blocked_id` null, so the list cannot
-- tell a hidden card from a missing one.
create table if not exists blocks (
  id bigint generated always as identity primary key,
  blocker_id uuid not null references users(id) on delete cascade,
  blocked_id uuid references users(id) on delete cascade,
  handle_snapshot text not null,
  handle_norm text not null,
  created_at timestamptz not null default now(),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create unique index if not exists blocks_pair_unique on blocks (blocker_id, blocked_id) where blocked_id is not null;
create unique index if not exists blocks_name_unique on blocks (blocker_id, handle_norm);
create index if not exists blocks_blocked_idx on blocks (blocked_id);

-- A report of a card. A reason from a fixed list and the name at the time;
-- no free text anywhere.
create table if not exists social_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references users(id) on delete set null,
  target_id uuid references users(id) on delete set null,
  handle_snapshot text not null,
  reason text not null check (reason in ('name', 'impersonation', 'other')),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

-- What happened, for moderation: who, which action, to whom. `meta` holds
-- names at the time, never an email, a wallet or a token. The evening cron
-- keeps a year.
create table if not exists social_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references users(id) on delete set null,
  action text not null,
  target_id uuid references users(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists social_audit_actor_idx on social_audit (actor_id, created_at desc);

-- Phase 3 (docs/plans/account-linking.md): two accounts one person proved
-- both of become one. The absorbed users row is never deleted: it is
-- marked retired into the survivor (`retired_into`), keeps the few rows
-- that would have been duplicates, and every sign in that names it (its
-- Privy DID, now 'merged:<did>', or a wallet, now the survivor's) reaches
-- the survivor instead (lib/server/accounts). `portfolio_rebuild_at` asks
-- the evening cron to redraw the survivor's ledger days from the joined
-- orders (lib/server/portfolio rebuildMergedPortfolios); cleared once it
-- has. No stored day of either account is ever deleted by a merge.
alter table users add column if not exists retired_into uuid references users(id);
alter table users add column if not exists retired_at timestamptz;
alter table users add column if not exists portfolio_rebuild_at timestamptz;

-- When a merge moved this identifier onto its account: a wallet session
-- signed before then was made for the absorbed account and is refused
-- (lib/server/rewards-route), so the browser signs in afresh.
alter table user_identities add column if not exists merged_at timestamptz;

-- One row per merge, and at most one per absorbed account ever. `status`
-- is 'pending' while it runs, 'failed' (with `error`, a code, never data)
-- when the transaction rolled back, 'done' once it committed, with the row
-- counts in `moved`. A retry of a pending or failed merge runs the whole
-- transaction again; a retry of a done one changes nothing and answers the
-- same counts.
create table if not exists account_merges (
  id uuid primary key default gen_random_uuid(),
  survivor_id uuid not null references users(id),
  absorbed_id uuid not null references users(id),
  reason text not null check (reason in ('email', 'wallet')),
  status text not null default 'pending' check (status in ('pending', 'failed', 'done')),
  moved jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  constraint account_merges_absorbed_once unique (absorbed_id),
  constraint account_merges_not_self check (survivor_id <> absorbed_id)
);

create index if not exists account_merges_survivor_idx on account_merges (survivor_id);

-- Which proof let the merge happen: 'email:<did>' (a code entered in the
-- last ten minutes) or 'wallet:<caip10>' (a signature made for it). Never
-- a secret: no token, no code, no signature.
alter table account_merges add column if not exists proof_ref text;

-- The merge itself (lib/server/account-merge), one function so it is one
-- transaction: every row the absorbed account owns moves to the survivor,
-- or nothing does. Its statements begin with their semicolon, so that
-- db:push, which splits at a semicolon ending a line, keeps it whole.
create or replace function merge_accounts(p_merge uuid, p_survivor uuid, p_absorbed uuid) returns jsonb language plpgsql as $$
declare
  m record
  ; s uuid := p_survivor
  ; a uuid := p_absorbed
  ; s_row record
  ; a_row record
  ; a_home text
  ; a_first date
  ; a_norm text
  ; n int
  ; n2 int
  ; v_moved jsonb := '{}'::jsonb
; begin
  select * into m from account_merges where id = p_merge for update
  ; if not found or m.survivor_id <> s or m.absorbed_id <> a then raise exception 'merge row mismatch' using errcode = 'P0001'
  ; end if
  ; if m.status = 'done' then return m.moved
  ; end if
  -- Both rows, locked in id order so two merges cannot deadlock.
  ; perform 1 from users where id in (s, a) order by id for update
  ; select * into s_row from users where id = s
  ; if not found then raise exception 'merge account missing' using errcode = 'P0002'
  ; end if
  ; select * into a_row from users where id = a
  ; if not found then raise exception 'merge account missing' using errcode = 'P0002'
  ; end if
  ; if s_row.retired_into is not null or a_row.retired_into is not null then raise exception 'merge account retired' using errcode = 'P0003'
  ; end if
  ; perform set_config('berth.merging', 'on', true)
  -- The rows shared with other people (friendships, salutes, blocks,
  -- requests), locked up front in one fixed order, so a friend accepting
  -- or a block landing mid merge waits rather than deadlocks.
  ; perform 1 from friends where a_id in (s, a) or b_id in (s, a) order by a_id, b_id for update
  ; perform 1 from salutes where giver_id in (s, a) or recipient_id in (s, a) order by giver_id, recipient_id for update
  ; perform 1 from blocks where blocker_id in (s, a) or blocked_id in (s, a) order by id for update
  ; perform 1 from friend_requests where from_id in (s, a) or to_id in (s, a) order by id for update

  -- Identities. The absorbed row's own columns are recorded first, in case
  -- the backfill never reached them. All move over as linked, not home and
  -- not primary: the survivor keeps its one home EVM address and its
  -- primary email. Only a survivor with no home at all takes the absorbed
  -- home as its own, so its buys still have somewhere to land.
  ; insert into user_identities (user_id, kind, value, family, is_home, proof)
      select a, 'wallet', 'eip155:' || a_row.wallet_address, 'evm', false, 'legacy'
      where a_row.wallet_address ~ '^0x[0-9a-f]{40}$'
      on conflict do nothing
  ; insert into user_identities (user_id, kind, value, is_primary, proof)
      select a, 'email', lower(btrim(a_row.email)), false, 'legacy'
      where a_row.email is not null and btrim(a_row.email) <> ''
      on conflict do nothing
  -- The survivor's own email, if the backfill never recorded it, becomes
  -- its primary email identity first, ahead of any that moves over.
  ; insert into user_identities (user_id, kind, value, is_primary, proof)
      select s, 'email', lower(btrim(s_row.email)), not exists (select 1 from user_identities where user_id = s and is_primary), 'legacy'
      where s_row.email is not null and btrim(s_row.email) <> ''
      on conflict do nothing
  ; select value into a_home from user_identities where user_id = a and is_home
  ; if a_home is null and a_row.wallet_address ~ '^0x[0-9a-f]{40}$' then a_home := 'eip155:' || a_row.wallet_address
  ; end if
  ; update user_identities set user_id = s, is_home = false, is_primary = false, merged_at = now() where user_id = a
  -- The absorbed row lets go of its wallet column now, so the survivor may
  -- take the address as its home below. It cannot be left with no identity
  -- at all (users_identity), so its DID is retired here too.
  ; update users set privy_did = 'merged:' || coalesce(privy_did, id::text), wallet_address = null where id = a
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('identities', n)
  ; if a_home is not null and s_row.wallet_address is null
       and not exists (select 1 from user_identities where user_id = s and is_home) then
      update user_identities set is_home = true where user_id = s and kind = 'wallet' and value = a_home and unlinked_at is null
      ; update users set wallet_address = substr(a_home, 8) where id = s
  ; end if
  ; update user_identities set is_primary = true
      where id = (select id from user_identities where user_id = s and kind = 'email' and unlinked_at is null order by created_at, value limit 1)
        and not exists (select 1 from user_identities where user_id = s and is_primary)

  -- Stored days are never deleted or moved: both accounts keep theirs, and
  -- the history read (lib/server/portfolio loadPortfolioDays) adds the
  -- retired account's days to the survivor's, day by day, until the
  -- survivor has a row written after the merge. When the absorbed account
  -- has any order or day, the evening cron is asked to redraw the
  -- survivor's ledger days from the joined orders (never a snapshot).
  ; select least(
        (select min(day) from portfolio_days where user_id = a),
        (select min(coalesce(placed_at, filled_at, created_at))::date from orders where user_id = a)
      ) into a_first

  -- The ledger: orders (their order_marks follow by order id), limit
  -- orders, pending pour claims, and the assistant's usage history.
  ; update orders set user_id = s where user_id = a
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('orders', n)
  ; update limit_orders set user_id = s where user_id = a
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('limitOrders', n)
  -- A claim both accounts hold on one intent stays once, the survivor's.
  ; delete from pour_claims c where c.user_id = a
      and exists (select 1 from pour_claims o where o.user_id = s and o.intent_tx = c.intent_tx)
  ; update pour_claims set user_id = s where user_id = a
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('pourClaims', n)
  ; update chat_usage set user_id = s where user_id = a
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('chatUsage', n)
  ; update mcp_calls set user_id = s where user_id = a
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('mcpCalls', n)

  -- Recurring buys (lib/server/recurring): the plans and their runs move,
  -- so future buys, recorded under the survivor, still answer them. The
  -- cap of ten is checked only when a plan is made or resumed, so past ten
  -- running the newest wait paused, their waiting runs let go, none
  -- deleted. Both accounts' recurring locks are taken first, in id order,
  -- the lock the cap triggers take: a plan made or resumed on either at
  -- this moment waits for the merge and then counts what it moved.
  ; perform pg_advisory_xact_lock(hashtextextended('recurring:' || least(s, a)::text, 0))
  ; perform pg_advisory_xact_lock(hashtextextended('recurring:' || greatest(s, a)::text, 0))
  ; update recurring_plans set user_id = s where user_id = a
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('recurringPlans', n)
  ; update recurring_runs set user_id = s where user_id = a
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('recurringRuns', n)
  ; update recurring_plans p set paused = true, updated_at = now()
      from (select id, row_number() over (order by created_at, id) as rn from recurring_plans where user_id = s and not paused) ranked
     where p.id = ranked.id and ranked.rn > 10
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('recurringPaused', n)
  ; update recurring_runs r set status = 'skipped', closed_at = now()
      from recurring_plans p
     where p.id = r.plan_id and p.user_id = s and p.paused and r.status in ('due', 'opened')

  -- Email switches (lib/server/email/store): the more careful choice
  -- wins, kind by kind. A kind either account switched off stays off; one
  -- the absorbed account switched on changes nothing, the survivor's own
  -- choice or default stands. The absorbed rows stay, for the record.
  ; insert into email_prefs (user_id, kind, enabled, updated_at)
      select s, kind, false, now() from email_prefs where user_id = a and not enabled
      on conflict (user_id, kind) do update set enabled = false, updated_at = now() where email_prefs.enabled
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('emailPrefsOff', n)

  ; if a_first is not null then
      update users set portfolio_rebuild_at = now() where id = s
  ; end if

  -- XP. An event with a ref (an order, a friend's first order) is unique
  -- across every account already, so it moves as it is. A ref that names
  -- the absorbed account itself ('<id>:<mode>', theme_tried) is rewritten
  -- to name the survivor, and stays behind when the survivor already has
  -- it. A once per account kind the survivor already has stays on the
  -- absorbed row, kept for the record and never paid twice. XP one side
  -- earned for inviting the other (friend_poured, and the invitee's
  -- invite_accepted) was a person inviting themselves: it rests on the
  -- retired row, whichever side it was paid to. Both totals are then
  -- summed afresh from the events, never added together.
  -- (The survivor's own invite_accepted keeps its row but takes the ref
  -- 'self:<survivor>' on the way, so the absorbed row can hold it beside
  -- any invite_accepted of its own.)
  ; update xp_events set user_id = a, ref = coalesce(ref, 'self:' || s::text)
      where user_id = s and ((kind = 'friend_poured' and ref = a::text)
        or (kind = 'invite_accepted' and ref is null and s_row.referred_by is not distinct from a))
  ; update xp_events e set user_id = s, ref = s::text || substr(e.ref, length(a::text) + 1)
      where e.user_id = a and e.ref like a::text || ':%'
        and not exists (select 1 from xp_events x where x.kind = e.kind and x.ref = s::text || substr(e.ref, length(a::text) + 1))
  ; get diagnostics n2 = row_count
  ; update xp_events e set user_id = s
      where e.user_id = a
        and coalesce(e.ref, '') not like a::text || ':%'
        and not (e.kind = 'friend_poured' and coalesce(e.ref, '') in (s::text, a::text))
        and not (e.kind = 'invite_accepted' and (coalesce(e.ref, '') = 'self:' || s::text or (e.ref is null and a_row.referred_by is not distinct from s)))
        and (e.ref is not null or not exists (select 1 from xp_events x where x.user_id = s and x.kind = e.kind and x.ref is null))
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('xpEvents', n + n2)
  ; select count(*) into n from xp_events where user_id = a
  ; v_moved := v_moved || jsonb_build_object('xpEventsKept', n)
  ; update users set xp = coalesce((select sum(amount) from xp_events where user_id = s), 0), updated_at = now() where id = s
  ; update users set xp = coalesce((select sum(amount) from xp_events where user_id = a), 0) where id = a

  -- Referrals. The survivor keeps its own referrer, and the absorbed
  -- account's referrer is dropped. Whoever the absorbed account invited is
  -- now the survivor's (the survivor itself, if it was one, is nobody's).
  -- An account retired into the absorbed one now points at the survivor, so
  -- an old invite code resolves in one step.
  ; update users set referred_by = s where referred_by = a and id <> s
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('referrals', n)
  ; update users set referred_by = null where id = s and referred_by = a
  ; update users set retired_into = s where retired_into = a

  -- Usernames. The survivor keeps its own. A survivor with none takes the
  -- absorbed one, card and all. Otherwise the absorbed one is released
  -- after the usual 90 day hold, held for the survivor, who may take it.
  ; if not exists (select 1 from handles where user_id = s) then
      update handles set user_id = s where user_id = a
      ; update profiles set user_id = s where user_id = a and not exists (select 1 from profiles where user_id = s)
  ; end if
  ; select handle_norm into a_norm from handles where user_id = a
  ; if a_norm is not null then
      delete from handles where user_id = a
      ; insert into handle_reserved (handle_norm, reason, user_id, until)
          values (a_norm, 'retired', s, now() + interval '90 days')
          on conflict (handle_norm) do update set user_id = excluded.user_id, until = excluded.until
          where handle_reserved.reason = 'retired'
  ; end if
  ; update handle_reserved set user_id = s where user_id = a and reason = 'retired'
  ; update profiles set visible = false, hidden_at = coalesce(hidden_at, now()), updated_at = now() where user_id = a

  -- Salutes, without duplicates: one person salutes a card once. Where
  -- both accounts saluted the same card (or were saluted by the same
  -- person) the survivor's row stays, live if either was, dated the
  -- earlier. A salute between the two accounts goes.
  ; update salutes y set revoked_at = case when x.revoked_at is null then null else y.revoked_at end, first_at = least(y.first_at, x.first_at)
      from salutes x where x.giver_id = a and y.giver_id = s and y.recipient_id = x.recipient_id
  ; update salutes y set revoked_at = case when x.revoked_at is null then null else y.revoked_at end, first_at = least(y.first_at, x.first_at)
      from salutes x where x.recipient_id = a and y.recipient_id = s and y.giver_id = x.giver_id
  ; update salutes x set giver_id = s
      where x.giver_id = a and x.recipient_id <> s
        and not exists (select 1 from salutes y where y.giver_id = s and y.recipient_id = x.recipient_id)
  ; get diagnostics n = row_count
  ; update salutes x set recipient_id = s
      where x.recipient_id = a and x.giver_id <> s
        and not exists (select 1 from salutes y where y.recipient_id = s and y.giver_id = x.giver_id)
  ; get diagnostics n2 = row_count
  ; v_moved := v_moved || jsonb_build_object('salutes', n + n2)
  ; delete from salutes where giver_id = a or recipient_id = a

  -- Friends, without duplicates and past the cap if need be. Live
  -- requests move where they do not repeat one the survivor already has
  -- or ask for a friend it already has; the rest are withdrawn. The
  -- absorbed account's friend link stops working.
  ; insert into friends (a_id, b_id, since)
      select least(s, f.other), greatest(s, f.other), f.since
        from (select case when a_id = a then b_id else a_id end as other, since from friends where a_id = a or b_id = a) f
       where f.other <> s
      on conflict (a_id, b_id) do update set since = least(friends.since, excluded.since)
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('friends', n)
  ; delete from friends where a_id = a or b_id = a
  ; update friend_requests r set from_id = s
      where r.from_id = a and r.status in ('pending', 'declined') and r.to_id <> s
        and not exists (select 1 from friend_requests q where q.from_id = s and q.to_id = r.to_id and q.status in ('pending', 'declined'))
        and not exists (select 1 from friends f where f.a_id = least(s, r.to_id) and f.b_id = greatest(s, r.to_id))
  ; update friend_requests r set to_id = s
      where r.to_id = a and r.status in ('pending', 'declined') and r.from_id <> s
        and not exists (select 1 from friend_requests q where q.to_id = s and q.from_id = r.from_id and q.status in ('pending', 'declined'))
        and not exists (select 1 from friends f where f.a_id = least(s, r.from_id) and f.b_id = greatest(s, r.from_id))
  ; update friend_requests set status = 'withdrawn', responded_at = coalesce(responded_at, now())
      where (from_id = a or to_id = a) and status in ('pending', 'declined')
  ; update friend_links set revoked_at = now() where user_id = a and revoked_at is null
  -- A report about the absorbed card is about the person, who is the survivor now.
  ; update social_reports set target_id = s where target_id = a

  -- Blocks, unioned: whoever either account blocked, the survivor blocks,
  -- and whoever blocked either account blocks the survivor. A block still
  -- does what it always does, so friendships, live requests and salutes
  -- across a block the merge created end here.
  ; update blocks b set blocker_id = s
      where b.blocker_id = a and b.blocked_id is distinct from s
        and not exists (select 1 from blocks c where c.blocker_id = s and (c.handle_norm = b.handle_norm or (b.blocked_id is not null and c.blocked_id = b.blocked_id)))
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('blocks', n)
  ; update blocks b set blocked_id = s
      where b.blocked_id = a and b.blocker_id <> s
        and not exists (select 1 from blocks c where c.blocker_id = b.blocker_id and c.blocked_id = s)
  ; delete from blocks where blocker_id = a or blocked_id = a
  ; delete from friends f using blocks b
      where b.blocked_id is not null and s in (b.blocker_id, b.blocked_id)
        and f.a_id = least(b.blocker_id, b.blocked_id) and f.b_id = greatest(b.blocker_id, b.blocked_id)
  ; update friend_requests r set status = 'withdrawn', responded_at = coalesce(r.responded_at, now())
      from blocks b
      where b.blocked_id is not null and s in (b.blocker_id, b.blocked_id) and r.status in ('pending', 'declined')
        and ((r.from_id = b.blocker_id and r.to_id = b.blocked_id) or (r.from_id = b.blocked_id and r.to_id = b.blocker_id))
  ; update salutes x set revoked_at = now()
      from blocks b
      where b.blocked_id is not null and s in (b.blocker_id, b.blocked_id) and x.revoked_at is null
        and ((x.giver_id = b.blocker_id and x.recipient_id = b.blocked_id) or (x.giver_id = b.blocked_id and x.recipient_id = b.blocker_id))

  -- Assistants: an assistant allowed into one account never silently gets
  -- another, so the absorbed account's grants, their tokens and any
  -- unused code end. The person connects it again.
  ; update oauth_grants set revoked_at = now() where user_id = a and revoked_at is null
  ; get diagnostics n = row_count
  ; v_moved := v_moved || jsonb_build_object('grantsRevoked', n)
  ; update oauth_tokens t set revoked_at = now() from oauth_grants g where t.grant_id = g.id and g.user_id = a and t.revoked_at is null
  ; update oauth_codes set used_at = now() where user_id = a and used_at is null

  -- The absorbed row retires: no email and no referrer, and (from above)
  -- no wallet and its DID kept only as 'merged:<did>', which no Privy token
  -- can present, so a sign in with it finds the survivor. Kept, never
  -- deleted.
  ; update users set
      retired_into = s,
      retired_at = now(),
      email = null,
      referred_by = null,
      portfolio_rebuild_at = null,
      updated_at = now()
    where id = a
  ; select xp into n from users where id = s
  ; v_moved := v_moved || jsonb_build_object('survivorXp', n)

  ; insert into account_audit (user_id, action, detail) values
      (s, 'account_merged', jsonb_build_object('role', 'survivor', 'otherUserId', a, 'reason', m.reason, 'mergeId', m.id, 'v_moved', v_moved, 'droppedReferrer', a_row.referred_by)),
      (a, 'account_merged', jsonb_build_object('role', 'absorbed', 'otherUserId', s, 'reason', m.reason, 'mergeId', m.id))
  ; update account_merges set status = 'done', moved = v_moved, error = null, done_at = now() where id = m.id
  ; return v_moved
; end $$;

-- Email (docs/plans/recurring-email.md section 3, lib/server/email). What a
-- person chose to get by mail, one row per switchable kind they changed;
-- no row means the default (orders and friends on, weekly off). Security
-- notices have no row: they cannot be switched off.
create table if not exists email_prefs (
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('orders', 'friends', 'weekly')),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

-- Addresses mail must not go to: a hard bounce or a complaint, reported by
-- Resend's webhook. Normalised (trimmed, lowercased). Checked before every
-- send, security notices included, since the address is dead or hostile.
create table if not exists email_suppressions (
  address text primary key,
  reason text not null check (reason in ('bounce', 'complaint', 'suppressed')),
  provider_id text,
  at timestamptz not null default now()
);

-- One row per notice Berth tried to send, so a retry of the same event
-- sends nothing new: unique (type, ref), where ref is the event's own id
-- (the order, the grant, the merge). Holds no body and no address.
-- `status`: 'pending' while it goes out (or waits to be tried again),
-- 'sent' with Resend's id, 'failed' with a short code (never the address
-- or the body). `notice` is what the notice will say (names, a short
-- address, a price), kept only while it is pending so the morning and
-- evening passes can send it again, and cleared once it is sent or given
-- up. `day_key` (UTC day) holds the friend request's one email a day in
-- the database itself.
create table if not exists email_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  type text not null,
  ref text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider_id text,
  error text,
  notice jsonb,
  day_key text,
  attempts int not null default 1,
  created_at timestamptz not null default now(),
  constraint email_sends_type_ref unique (type, ref)
);

create index if not exists email_sends_user_idx on email_sends (user_id, type, created_at desc);
create index if not exists email_sends_pending_idx on email_sends (created_at) where status = 'pending';
create unique index if not exists email_sends_friend_daily
  on email_sends (user_id, day_key) where type = 'friend_request';

-- RETIRED 2026-10-04: recurring buys were removed from Berth (docs/adr/0007,
-- superseded). recurring_plans and recurring_runs are kept as they stand,
-- with their triggers, indexes and the merge's handling of them, so the
-- record of what people set is not lost; nothing in the app or the cron
-- reads or writes them any more. Do not drop them without a decision.
--
-- Recurring buys (docs/adr/0007, lib/recurring, lib/server/recurring, all
-- removed): reminders the person signed, never automatic execution. A plan is a
-- listing, a dollar amount and a day (weekly: weekday 0 Sunday to 6
-- Saturday; monthly: month_day 1 to 28, so February never skips), read in
-- the person's own time zone. next_due_at is the start (local midnight) of
-- the next day it comes due. At most ten plans an account, $1 to $10,000.
-- order_type 'limit' ("buy on the dip") only for accounts with limit
-- orders switched on: the draft is a limit buy dip_pct under the price at
-- reminder time.
create table if not exists recurring_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  listing_symbol text not null,
  usd numeric not null check (usd >= 1 and usd <= 10000),
  cadence text not null check (cadence in ('weekly', 'monthly')),
  weekday smallint check (weekday between 0 and 6),
  month_day smallint check (month_day between 1 and 28),
  time_zone text not null,
  order_type text not null default 'market' check (order_type in ('market', 'limit')),
  dip_pct numeric check (dip_pct is null or (dip_pct > 0 and dip_pct <= 50)),
  paused boolean not null default false,
  created_via text not null default 'app' check (created_via in ('app', 'assistant')),
  next_due_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_plans_day check (
    (cadence = 'weekly' and weekday is not null and month_day is null)
    or (cadence = 'monthly' and month_day is not null and weekday is null)
  )
);

create index if not exists recurring_plans_user_idx on recurring_plans (user_id, created_at);
create index if not exists recurring_plans_due_idx on recurring_plans (next_due_at) where not paused;

-- The cap of ten, race safe: after each new plan the trigger takes the
-- account's advisory lock and counts afresh, so two creates at nine cannot
-- both land (as friends_cap does). An account merge moves plans by update
-- and never meets it; it pauses the extras instead. One line body, for
-- db:push's split.
create or replace function recurring_plans_cap() returns trigger language plpgsql as $$
begin perform pg_advisory_xact_lock(hashtextextended('recurring:' || new.user_id::text, 0)); if (select count(*) from recurring_plans where user_id = new.user_id) > 10 then raise exception 'recurring plans cap reached' using errcode = 'check_violation'; end if; return null; end $$;

drop trigger if exists recurring_plans_cap on recurring_plans;

create trigger recurring_plans_cap after insert on recurring_plans for each row execute function recurring_plans_cap();

-- Resuming keeps to ten running plans, race safe the same way: after a
-- plan is unpaused the trigger takes the account's advisory lock and
-- counts the plans not paused afresh (lib/server/recurring setPaused
-- checks first). A merge only ever pauses, so it never meets it. One line
-- body, for db:push's split.
create or replace function recurring_plans_resume_cap() returns trigger language plpgsql as $$
begin perform pg_advisory_xact_lock(hashtextextended('recurring:' || new.user_id::text, 0)); if (select count(*) from recurring_plans where user_id = new.user_id and not paused) > 10 then raise exception 'recurring plans cap reached' using errcode = 'check_violation'; end if; return null; end $$;

drop trigger if exists recurring_plans_resume_cap on recurring_plans;

create trigger recurring_plans_resume_cap after update of paused on recurring_plans for each row when (old.paused and not new.paused) execute function recurring_plans_resume_cap();

-- One run per plan per due day: 'due' when the morning run (or the app)
-- finds it, 'opened' once the person opens its draft, 'placed' when an
-- order for that listing and amount is recorded within its window (the
-- pour route, or a limit order's record), 'skipped' when the person says
-- so or three days pass. limit_price is the dip price worked out at
-- reminder time, for a limit plan. order_id / limit_order_id link what
-- was signed. listing_symbol, usd and order_type are the plan as it stood
-- when the run was made: an edit afterwards never changes what a waiting
-- run asks for, or what answers it.
create table if not exists recurring_runs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references recurring_plans(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  due_at timestamptz not null,
  status text not null default 'due' check (status in ('due', 'opened', 'placed', 'skipped')),
  listing_symbol text not null,
  usd numeric not null,
  order_type text not null default 'market' check (order_type in ('market', 'limit')),
  limit_price numeric,
  order_id uuid references orders(id) on delete set null,
  limit_order_id uuid references limit_orders(id) on delete set null,
  emailed_at timestamptz,
  -- The reminder's final outcome: 'sent', or 'final' (switch off, no
  -- address, suppressed, already claimed). Null while a retry may still
  -- send it (the day's cap, a provider error).
  email_outcome text check (email_outcome is null or email_outcome in ('sent', 'final')),
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint recurring_runs_plan_due unique (plan_id, due_at)
);

create index if not exists recurring_runs_open_idx on recurring_runs (user_id, due_at) where status in ('due', 'opened');
-- One order answers at most one run, and so does one limit order: a replay
-- of the same intent never closes a second run.
create unique index if not exists recurring_runs_order_once on recurring_runs (order_id) where order_id is not null;
create unique index if not exists recurring_runs_limit_once on recurring_runs (limit_order_id) where limit_order_id is not null;

-- The recurring reminder's own switch, on by default for anyone with a plan.
-- Retired 2026-10-04 with the reminders: 'recurring' stays allowed so the
-- rows already written stay valid; the app no longer reads or writes it.
-- Production's only check on kind was email_prefs_kind_check (read
-- 2026-09-30); any other check naming kind, whatever it is called, is
-- dropped first too, so an older name can never keep refusing
-- 'recurring'. One line body, for db:push's split.
do $$ declare c record; begin for c in select conname from pg_constraint where conrelid = 'email_prefs'::regclass and contype = 'c' and conname <> 'email_prefs_kind_check' and pg_get_constraintdef(oid) ilike '%kind%' loop execute format('alter table email_prefs drop constraint %I', c.conname); end loop; end $$;

alter table email_prefs drop constraint if exists email_prefs_kind_check;
alter table email_prefs add constraint email_prefs_kind_check
  check (kind in ('orders', 'friends', 'weekly', 'recurring'));

-- The X column's own store (lib/server/x-store, lib/x-schedule). X bills
-- every post it returns, once per UTC day per post, so the posts are kept
-- here and each query asks X only for what is newer than its last post.
-- Nothing in these tables is about a person: they are public posts by the
-- accounts in lib/x-feed and the bookkeeping of reading them.
--
-- x_posts: every post a query returned, the post as X sent it (author
-- included) in `tweet`. A post returned again replaces its copy, so the
-- counts are the latest read. Pruned after eight days.
create table if not exists x_posts (
  id text primary key,
  query_key text not null,
  tier text not null check (tier in ('company', 'press')),
  tweet jsonb not null,
  posted_at timestamptz not null,
  fetched_at timestamptz not null
);

create index if not exists x_posts_posted_idx on x_posts (posted_at desc);

-- x_queries: per query, the newest post it has seen (`since_id`), when it
-- last got an answer (`fetched_at`) and when it last failed (`failed_at`,
-- which moves it down the rotation without touching since_id). `query` is
-- the text asked: when lib/x-feed changes a query, its since_id no longer
-- applies and it starts again.
create table if not exists x_queries (
  key text primary key,
  query text not null,
  since_id text,
  fetched_at timestamptz,
  failed_at timestamptz
);

-- x_fetch_slots: one row per slot of lib/x-schedule that some instance
-- claimed, so two instances never fetch the same slot. `ok` is null while
-- the fetch runs, true once anything came back, false when it all failed
-- (retried once, five minutes later). `queries` is the x_queries keys the
-- fetch asks, so a refresh running beside it asks the others.
create table if not exists x_fetch_slots (
  slot text primary key,
  attempts int not null default 1,
  claimed_at timestamptz not null,
  ok boolean,
  posts int,
  requests int,
  queries text[]
);

-- x_read_budget: posts read per UTC day, the day X bills by. `reserved`
-- is what requests in flight could still return, taken before they are
-- sent, so used + reserved never passes X_DAILY_POST_CAP.
create table if not exists x_read_budget (
  day text primary key,
  used int not null default 0,
  reserved int not null default 0,
  requests int not null default 0
);

-- The first stock's card (lib/first-stock): "Got it" closes it for good on
-- the account, on every device. The first close is kept; null is open.
alter table users add column if not exists first_stock_closed_at timestamptz;

-- Reward campaigns (lib/server/campaigns, docs/plans/campaigns.md). A
-- campaign is a link (/c/<code>) and a promise: "Buy at least $10 of any
-- stock or fund through this link, keep it for 7 days, and we add $5 in
-- USDC." Berth never sends the money: David pays each approved claim by
-- hand from the staff page, and records the transaction here. Created
-- inactive; only the staff page activates one, after counsel review. XP
-- and ranks stay the fun layer and are never the trigger.
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{2,31}$'),
  title text not null,
  amount_usd numeric not null default 5 check (amount_usd > 0),
  budget_usd numeric not null default 100 check (budget_usd > 0),
  max_claims int not null default 20 check (max_claims > 0),
  min_buy_usd numeric not null default 10 check (min_buy_usd > 0),
  hold_days int not null default 7 check (hold_days between 1 and 90),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default false,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint campaigns_dates check (ends_at > starts_at),
  constraint campaigns_budget_covers_one check (amount_usd <= budget_usd)
);

-- One row per account that arrived through a campaign link, written on the
-- account's first sync (the same birth certificate rule as an invite
-- code), so one account has at most one claim, ever. `state` walks
-- attributed (arrived, no verified email yet) -> buying (waiting for the
-- first qualifying buy) -> holding (the buy is in, a slot is reserved,
-- eligible_at says when the hold is judged) -> qualified (still held) ->
-- approved (by staff) -> paid (by David, by hand); or rejected (with a
-- reason, by staff or by the rules) or expired (the campaign ended or was
-- full first). holding, qualified, approved and paid hold a slot.
create table if not exists campaign_claims (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  user_id uuid not null references users(id),
  state text not null default 'attributed'
    check (state in ('attributed', 'buying', 'holding', 'qualified', 'approved', 'paid', 'rejected', 'expired')),
  -- The first qualifying buy, as the orders table recorded it.
  order_id uuid references orders(id) on delete set null,
  intent_tx text,
  buy_usd numeric,
  holding_since timestamptz,
  eligible_at timestamptz,
  -- The hold check: when it was judged, the last attempt that could not be
  -- (a failed read), and what it saw (listing, wallet, needed, balance).
  hold_checked_at timestamptz,
  hold_attempted_at timestamptz,
  -- The first run whose read of the hold window got no answer, cleared
  -- once one does. Past three days the queue flags it for review; past
  -- seven the claim is rejected (hold_unreadable) and its slot freed.
  hold_unreadable_since timestamptz,
  hold_evidence jsonb,
  qualified_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references users(id) on delete set null,
  rejected_at timestamptz,
  -- Null when the rules rejected it (not held, one per person, one per wallet).
  rejected_by uuid references users(id) on delete set null,
  reject_reason text,
  expired_at timestamptz,
  expire_reason text check (expire_reason in ('ended', 'full')),
  -- When the claim first found every place taken (lib/server/campaigns):
  -- it waits in this order for a place to free up until the deadline,
  -- and only then expires as full.
  waitlisted_at timestamptz,
  -- Where the USDC goes, fixed at approval: the account's own home address, on Base.
  payout_address text,
  payout_chain text,
  paid_at timestamptz,
  paid_by uuid references users(id) on delete set null,
  paid_tx text,
  -- The payment's hash. While paid_verified is false the claim stays
  -- approved (the hash is pending: not mined yet, or the RPC did not
  -- answer) and the hash can be checked again or replaced; the claim is
  -- paid only once a public RPC read shows USDC from an active payout
  -- source of its campaign (campaign_payout_sources) or the optional global
  -- STAFF_PAYOUT_ADDRESSES to payout_address on payout_chain.
  -- One transaction may pay several claims (a batch), as long as each
  -- recipient got the sum of its claims.
  paid_verified boolean,
  paid_check jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_claims_one_per_account unique (user_id)
);

create index if not exists campaign_claims_campaign_state_idx on campaign_claims (campaign_id, state);

-- A batch payout pays several claims with one hash.
create index if not exists campaign_claims_paid_tx_idx
  on campaign_claims (lower(paid_tx)) where paid_tx is not null;

-- Every wallet a claim stood on when its slot was reserved: the account's
-- linked wallets (unlinked ones too), its home, the buy's payer and where
-- the buy was delivered. A wallet takes part in a campaign once.
create table if not exists campaign_claim_wallets (
  campaign_id uuid not null references campaigns(id),
  wallet text not null,
  claim_id uuid not null references campaign_claims(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campaign_id, wallet)
);


-- The staff area (docs/adr/0008-staff-area.md, lib/server/staff-auth, app/staff).
-- Who on staff did what, and why: every page view of a person, every
-- reveal of a masked field (with its reason), every write. `staff_user_id`
-- is the staff member's own account; `target` names what was acted on
-- (`user:<id>`, `grant:<id>`, `send:<id>`, `budget:<service>`, never an
-- email or a wallet address); `detail` holds the reason and the outcome,
-- with any email or wallet in it masked before it is written. Rows are
-- never updated by the app; the evening run deletes rows older than 24
-- months (lib/server/cron-runs pruneStaffAudit), as the privacy policy says.
create table if not exists staff_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  staff_user_id uuid references users(id) on delete set null,
  action text not null,
  target text,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists staff_audit_at_idx on staff_audit (at desc);
create index if not exists staff_audit_staff_idx on staff_audit (staff_user_id, at desc);
create index if not exists staff_audit_target_idx on staff_audit (target, at desc);

-- An account staff marked as not eligible for campaign payouts (abuse, a
-- duplicate person, staff themselves). The campaigns logic reads
-- `campaign_ineligible_at is not null` and pays nothing; the why is in
-- staff_audit (action 'campaign_ineligible'), never here. Cleared by the
-- same audited action.
alter table users add column if not exists campaign_ineligible_at timestamptz;
alter table users add column if not exists campaign_ineligible_by uuid references users(id) on delete set null;

-- The staff area's signup charts and the users list read accounts by when
-- they were made.
create index if not exists users_created_idx on users (created_at);

-- One row per cron run (lib/server/cron-runs), written by the morning and
-- evening routes as they answer: when, whether it counted as a failure,
-- and the run's own summary (counts and stage outcomes only, the same JSON
-- the route already logs; never an address or an account id). Kept 90
-- days; each run deletes its job's older rows.
create table if not exists cron_runs (
  id bigint generated always as identity primary key,
  job text not null check (job in ('morning', 'evening')),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  ok boolean not null,
  summary jsonb not null default '{}'::jsonb
);

create index if not exists cron_runs_job_idx on cron_runs (job, started_at desc);

-- What Berth spent on a paid service per UTC day, metered where the call
-- is made (lib/server/spend-meter), for a service whose own bill Berth
-- cannot read: Jev (TypeSafe has no usage or balance endpoint), and
-- Resend's quota headers as last seen. `units` is the service's own unit
-- (estimated input tokens for Jev, emails for Resend); `cost_micros` is
-- USD millionths at the documented price, fractional, an estimate.
-- `provider` is the last quota the provider itself reported, if any.
-- Nothing in it is about a person.
create table if not exists service_spend (
  service text not null,
  day date not null,
  calls integer not null default 0,
  units bigint not null default 0,
  cost_micros numeric not null default 0,
  provider jsonb,
  updated_at timestamptz not null default now(),
  primary key (service, day)
);

-- What staff told Berth about each paid service (the Budgets page, every
-- change audited): the prepaid balance as read off the provider's own
-- dashboard and when (`balance_at`; remaining is that balance less what
-- was metered since), and the level below which the morning run emails
-- the staff admins. Null threshold: the default in lib/staff/budget-math.
create table if not exists staff_budgets (
  service text primary key,
  balance_usd numeric check (balance_usd is null or balance_usd >= 0),
  balance_at timestamptz,
  threshold numeric check (threshold is null or threshold >= 0),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Staff may put an address on the suppression list by hand (support, an
-- abuse report), audited in staff_audit; 'staff' says so. Any older check
-- naming reason is dropped first, whatever it is called. One line body,
-- for db:push's split.
do $$ declare c record; begin for c in select conname from pg_constraint where conrelid = 'email_suppressions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%reason%' loop execute format('alter table email_suppressions drop constraint %I', c.conname); end loop; end $$;

alter table email_suppressions add constraint email_suppressions_reason_check
  check (reason in ('bounce', 'complaint', 'suppressed', 'staff'));

-- One row per staff sign in (lib/server/staff-session). The cookie carries
-- only the signed session id; every request checks the row (live, not
-- expired, not revoked) and the allowlist in the environment. A session
-- lasts as long as the Privy token it came from (`expires_at`), and is
-- renewed only by a newer token for the same account, never past
-- `max_until`. `auth_at` is when the email code was last entered (Privy's
-- latest_verified_at), for the 15 minute fresh proof. "Sign out
-- everywhere" and a Berth sign out set `revoked_at`.
create table if not exists staff_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references users(id) on delete cascade,
  auth_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_until timestamptz not null,
  revoked_at timestamptz
);

create index if not exists staff_sessions_staff_idx on staff_sessions (staff_user_id) where revoked_at is null;

-- When this account last opened Berth signed in: the profile sync bumps it
-- at most once a UTC day (one conditional update). The staff Overview's
-- "active" counts read it; null before this release.
alter table users add column if not exists last_seen_at timestamptz;
create index if not exists users_last_seen_idx on users (last_seen_at);

-- A card hidden by staff (moderation), as distinct from the person's own
-- "Hide my card": staff may show again only what staff hid, and the
-- person's own switch cannot show a card staff hid.
alter table profiles add column if not exists staff_hidden_at timestamptz;

-- The staff Budgets page and Health count sent notices by day.
create index if not exists email_sends_sent_idx on email_sends (created_at) where status = 'sent';

-- The staff reveal limit counts a staff member's reveals in the last hour.
create index if not exists staff_audit_action_idx on staff_audit (staff_user_id, action, at desc);


-- Reserving a slot, in one transaction (lib/server/campaigns/eligibility):
-- the campaign row is locked first, so two claims racing for the last slot
-- are taken one after the other and only one gets it. Then the rules that
-- need every other claim in view: one per person (the claims of every
-- account merged into this one count as this person's), one per wallet,
-- and the budget and max_claims, counted over the claims holding a slot
-- plus the waitlisted claims ahead of this one. A claim that finds no
-- place waits (waitlisted_at) until the deadline (the end plus the hold's
-- days), and a place that frees goes to the claim that has waited
-- longest; only after the deadline is it expired as full. Answers 'holding', or why not: 'stale' (moved
-- already), 'inactive', 'outside' (the buy is not inside the campaign's
-- dates), 'one_per_person', 'wallet_used' (both keep the buy as evidence),
-- 'waitlisted', 'full'. Its
-- statements begin with their semicolon, so that db:push, which splits at
-- a semicolon ending a line, keeps it whole.
create or replace function campaign_reserve(p_claim uuid, p_person uuid, p_order uuid, p_intent text, p_buy_usd numeric, p_since timestamptz, p_wallets text[], p_now timestamptz) returns text language plpgsql as $$
declare
  c record
  ; cl record
  ; n int
  ; ahead int
; begin
  select * into cl from campaign_claims where id = p_claim
  ; if not found then return 'stale'
  ; end if
  ; select * into c from campaigns where id = cl.campaign_id for update
  ; select * into cl from campaign_claims where id = p_claim for update
  ; if cl.state not in ('attributed', 'buying') then return 'stale'
  ; end if
  ; if not c.active then return 'inactive'
  ; end if
  ; if p_since < c.starts_at or p_since > c.ends_at then return 'outside'
  ; end if
  ; if exists (
      select 1 from campaign_claims o join users u on u.id = o.user_id
       where o.campaign_id = c.id and o.id <> cl.id
         and coalesce(u.retired_into, u.id) = p_person
         and o.state in ('holding', 'qualified', 'approved', 'paid')
    ) then
    update campaign_claims set state = 'rejected', reject_reason = 'one_per_person', order_id = p_order, intent_tx = p_intent, buy_usd = p_buy_usd, rejected_at = p_now, updated_at = p_now where id = cl.id
    ; return 'one_per_person'
  ; end if
  ; if exists (
      select 1 from campaign_claim_wallets w
       where w.campaign_id = c.id and w.wallet = any(p_wallets) and w.claim_id <> cl.id
    ) then
    update campaign_claims set state = 'rejected', reject_reason = 'wallet_used', order_id = p_order, intent_tx = p_intent, buy_usd = p_buy_usd, rejected_at = p_now, updated_at = p_now where id = cl.id
    ; return 'wallet_used'
  ; end if
  ; select count(*) into n from campaign_claims
     where campaign_id = c.id and state in ('holding', 'qualified', 'approved', 'paid')
  ; select count(*) into ahead from campaign_claims
     where campaign_id = c.id and id <> cl.id and state in ('attributed', 'buying')
       and waitlisted_at is not null
       and (cl.waitlisted_at is null or waitlisted_at < cl.waitlisted_at or (waitlisted_at = cl.waitlisted_at and id < cl.id))
  ; if n + ahead >= c.max_claims or (n + ahead + 1) * c.amount_usd > c.budget_usd then
    if p_now > c.ends_at + make_interval(days => c.hold_days) then
      update campaign_claims set state = 'expired', expire_reason = 'full', expired_at = p_now, updated_at = p_now where id = cl.id
      ; return 'full'
    ; end if
    ; update campaign_claims set waitlisted_at = coalesce(waitlisted_at, p_now), updated_at = p_now where id = cl.id
    ; return 'waitlisted'
  ; end if
  ; insert into campaign_claim_wallets (campaign_id, wallet, claim_id)
    select c.id, w, cl.id from unnest(p_wallets) as w where w is not null
    on conflict do nothing
  ; update campaign_claims
       set state = 'holding', order_id = p_order, intent_tx = p_intent, buy_usd = p_buy_usd,
           holding_since = p_since, eligible_at = p_since + make_interval(days => c.hold_days),
           waitlisted_at = null, updated_at = p_now
     where id = cl.id
  ; return 'holding'
; end $$;

-- The wallets a campaign's payouts may come from (lib/server/campaigns
-- actions markClaimPaid): Mark paid accepts a USDC transfer only from an
-- active source of the claim's campaign, or from STAFF_PAYOUT_ADDRESSES,
-- the optional global fallback. Managed on /staff/campaigns by admins with
-- a fresh sign in and a reason, each change audited in the same statement.
-- A removed source keeps its row (removed_at), and removing one never
-- touches a claim already paid. `address` is lowercase; the page shows it
-- checksummed.
create table if not exists campaign_payout_sources (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  address text not null check (address ~ '^0x[0-9a-f]{40}$'),
  added_by uuid references users(id) on delete set null,
  added_at timestamptz not null default now(),
  added_reason text not null,
  removed_by uuid references users(id) on delete set null,
  removed_at timestamptz,
  removed_reason text
);

create unique index if not exists campaign_payout_sources_active
  on campaign_payout_sources (campaign_id, address) where removed_at is null;

-- Marking a claim paid, in one transaction (lib/server/campaigns actions
-- markClaimPaid): the transaction hash is locked first, so two claims at
-- one address cannot both be paid by one transfer meant for one; then the
-- claim's row. The transfer to the claim's address (p_paid_raw, USDC raw
-- units from the house's payout wallets, read by the caller) must cover
-- this claim and every other claim the hash already stands for at that
-- address. The write and its audit row commit together. Answers 'paid',
-- 'short' or 'wrong_state'. Its statements begin with their semicolon, so
-- that db:push, which splits at a semicolon ending a line, keeps it whole.
create or replace function campaign_mark_paid(p_claim uuid, p_tx text, p_paid_raw numeric, p_staff uuid, p_check jsonb, p_action text, p_detail jsonb) returns text language plpgsql as $$
declare
  cl record
  ; amount numeric
  ; others numeric
; begin
  perform pg_advisory_xact_lock(hashtextextended('campaign_paid:' || p_tx, 0))
  ; select * into cl from campaign_claims where id = p_claim for update
  ; if not found or cl.state <> 'approved' or cl.payout_address is null then return 'wrong_state'
  ; end if
  ; select amount_usd into amount from campaigns where id = cl.campaign_id
  ; select coalesce(sum(k.amount_usd), 0) into others
      from campaign_claims o join campaigns k on k.id = o.campaign_id
     where lower(o.paid_tx) = p_tx and o.payout_address = cl.payout_address and o.id <> cl.id
       and o.state in ('approved', 'paid')
  ; if (others + amount) * 1000000 > p_paid_raw then return 'short'
  ; end if
  ; update campaign_claims
       set state = 'paid', paid_at = now(), paid_by = p_staff, paid_tx = p_tx, paid_verified = true,
           paid_check = p_check, updated_at = now()
     where id = p_claim
  ; insert into staff_audit (staff_user_id, action, target, detail)
    values (p_staff, p_action, p_claim::text, p_detail || jsonb_build_object('outcome', 'done'))
  ; return 'paid'
; end $$;

-- The guided first path (lib/first-path, lib/server/first-path): one row per
-- account that has touched it. Every step is decided by facts read elsewhere
-- (avatar, username, orders, friends); this keeps only what no other table
-- knows: which steps were set aside, that money was once seen in the
-- account (the balances live on chain), that an invite link was shared, and
-- that "You're set up" was closed, after which the path never shows again.
create table if not exists first_paths (
  user_id uuid primary key references users(id) on delete cascade,
  skipped text[] not null default '{}',
  funded_at timestamptz,
  invite_shared_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Wallet sessions ended on the server (lib/server/wallet-session-revocations):
-- a wallet session is a self-issued JWT, so signing out records its id here
-- and every route that reads a session refuses one listed. A row is needed
-- only until the token would have expired anyway; older rows are pruned.
create table if not exists wallet_session_revocations (
  jti text primary key,
  address text not null,
  revoked_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists wallet_session_revocations_expires on wallet_session_revocations (expires_at);

-- The news store (lib/server/news-store, lib/server/news-ingest): one row per
-- distinct story, whichever sources carried it, so Jev judges a story once
-- and every reader (the column, the moves, the first look, the nudge, the
-- MCP tools) reads the same verdict. Source items fold into a story by
-- canonical url, then normalised title, then close wording on a shared
-- listing (lib/news-fold). Only the verbatim title, the publisher, the time
-- and the link are ever shown: never a summary or an image from a third
-- party. `symbols` mirrors story_listings for display; the index is there.
create table if not exists stories (
  id bigserial primary key,
  fingerprint text not null unique,
  kind text not null check (kind in ('article', 'post')),
  title text not null,
  url text not null,
  publisher text not null,
  lead_source_id bigint,
  symbols text[] not null default '{}',
  published_at timestamptz not null,
  last_item_at timestamptz not null,
  publisher_count int not null default 1,
  hidden_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stories_published on stories (published_at desc);

-- story_sources: each source's own item. Idempotent on (source, source_id).
-- `raw` carries what a card must show for an X post (author, avatar, counts)
-- and nothing a card may not show. Marketaux rows (David's Basic plan,
-- 2026-10-02) hold its title, link, publisher, time and matched listings
-- only; readers show them as NEWS_MARKETAUX says (lib/news-schedule).
create table if not exists story_sources (
  id bigserial primary key,
  story_id bigint not null references stories(id) on delete cascade,
  source text not null check (source in ('nasdaq', 'x', 'edgar', 'marketaux', 'finnhub')),
  source_id text not null,
  publisher text not null,
  url text not null,
  canonical_url text,
  title text not null,
  title_key text not null,
  published_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  raw jsonb,
  unique (source, source_id)
);

create index if not exists story_sources_story on story_sources (story_id);
-- Folding happens in memory over a run's fold index, which reads by time.
create index if not exists story_sources_published on story_sources (published_at);

create table if not exists story_listings (
  story_id bigint not null references stories(id) on delete cascade,
  symbol text not null,
  tagged_by text not null check (tagged_by in ('feed', 'topic', 'jev')),
  primary key (story_id, symbol)
);

create index if not exists story_listings_symbol on story_listings (symbol, story_id);

-- story_verdicts: Jev's reading of one story about one listing, asked once
-- per judge version and reused by every reader. `kept` is the column's own
-- rule (lib/news-judge keepHeadline, readPostAnswers), stored so a reader
-- never needs Jev.
create table if not exists story_verdicts (
  story_id bigint not null references stories(id) on delete cascade,
  symbol text not null,
  judge_version text not null,
  about real,
  substance real,
  verdict text check (verdict in ('material', 'fact', 'analysis')),
  kept boolean not null,
  tokens int,
  judged_at timestamptz not null default now(),
  primary key (story_id, symbol, judge_version)
);

create index if not exists story_verdicts_judged on story_verdicts (judged_at desc);

-- jev_answers: every Jev answer by the fingerprint of its exact question and
-- state (lib/server/jev cachedVerdict). It replaced a two week data cache
-- that an eviction or a deploy could empty, which then paid Jev again.
create table if not exists jev_answers (
  fingerprint text not null,
  version text not null,
  answer jsonb not null,
  at timestamptz not null default now(),
  primary key (fingerprint, version)
);

create index if not exists jev_answers_at on jev_answers (at);

-- news_fetch_slots: the one on-demand ingest per New York slot of
-- lib/x-schedule, claimed so two instances never both run it (as
-- x_fetch_slots does for X), plus one refresh per slot from the button.
create table if not exists news_fetch_slots (
  source text not null,
  slot text not null,
  attempts int not null default 0,
  claimed_at timestamptz,
  ok boolean,
  requests int,
  primary key (source, slot)
);

-- news_budget: requests (or Jev tokens) per source per UTC day, reserved
-- before they are sent, so each source's hard daily cap holds whatever the
-- traffic (lib/news-schedule caps). A killed run leaves its reservation
-- held, which errs toward spending less.
-- A source with a per-minute limit too (Marketaux, 30 a minute) keeps rows
-- under '<source>-minute' with the UTC minute (YYYY-MM-DDTHH:MM) as `day`,
-- pruned after a week.
create table if not exists news_budget (
  source text not null,
  day text not null,
  used int not null default 0,
  reserved int not null default 0,
  requests int not null default 0,
  primary key (source, day)
);

-- news_cursors: how far back a source's query has been heard, per query
-- (Marketaux: per group of four listings, key "AAPL,AMD,MSTR,NVDA").
-- `covered_to`: everything published before it (less an overlap) is in.
-- While a window is being paged back, newest first, `paging_top` is the
-- window's upper end and `paging_before` the next page's published_before;
-- the window counts as covered (covered_to = paging_top) only once the last
-- page is in. A run stopped by a cap, the deadline or an outage resumes
-- from the cursor on the next run, so nothing between is lost.
create table if not exists news_cursors (
  source text not null,
  key text not null,
  covered_to timestamptz,
  paging_top timestamptz,
  paging_before timestamptz,
  updated_at timestamptz not null default now(),
  primary key (source, key)
);

-- listing_events: dated facts about a listing, written by code, never by AI.
-- Filings from SEC EDGAR now (public domain); earnings, dividends and splits
-- only once a licensed source and the token's own mechanics are settled.
-- `shown` is false for forms that are noise to a holder (Form 4, 144).
create table if not exists listing_events (
  id bigserial primary key,
  symbol text not null,
  kind text not null check (kind in ('earnings', 'filing', 'dividend', 'split')),
  day date not null,
  detail jsonb not null default '{}',
  source text not null check (source in ('finnhub', 'edgar')),
  source_ref text not null,
  shown boolean not null default true,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (symbol, kind, source_ref)
);

create index if not exists listing_events_day on listing_events (day, symbol);

-- In-app notices said once per account (lib/server/notices): a change the
-- policy promises to say in the app before it applies. One row once the
-- person has seen and closed it; no row, the notice is still due. `notice`
-- is a fixed id from code (lib/social-proof SOCIAL_NOTICE_ID), never text.
create table if not exists account_notices (
  user_id uuid not null references users(id) on delete cascade,
  notice text not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, notice)
);

-- Most bought on Berth (lib/server/social-proof): one stored answer per
-- fixed Monday to Sunday UTC week, written once by the first request after
-- the week is published (insert on conflict do nothing) and served as is
-- by every instance from then on, whatever is recorded late. `answer` is
-- the public response itself: listing symbols and rounded counts, never a
-- person, an account or an amount.
create table if not exists most_bought_weeks (
  week_start date primary key,
  answer jsonb not null,
  computed_at timestamptz not null default now()
);

-- Most held on Berth (lib/server/most-held): the sibling of
-- most_bought_weeks, on the same weeks and the same publish. One stored
-- answer per fixed Monday to Sunday UTC week, counted from each account's
-- last portfolio_days record at the week's close, written once by the first
-- request after the week is published (insert on conflict do nothing) and
-- served as is from then on. `answer` is the public response itself:
-- listing symbols and a rounded "1 in N" each, never a count, a person, an
-- account or an amount.
create table if not exists most_held_weeks (
  week_start date primary key,
  answer jsonb not null,
  computed_at timestamptz not null default now()
);

-- What the home last showed an account (lib/last-known): its figure in
-- parts, the stage and the holdings, saved by the browser only once every
-- part was read live, so the next visit on any device opens on these,
-- marked as updating, while the live reads arrive. Display only: nothing
-- that moves money reads it. One row per account, replaced in place;
-- `snapshot` is validated by lib/last-known parseSnapshot before it is
-- stored. Read back only to the same account (app/api/account/last-known).
create table if not exists home_last_known (
  user_id uuid primary key references users(id) on delete cascade,
  snapshot jsonb not null,
  as_of timestamptz not null default now()
);
