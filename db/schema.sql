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

-- Once-per-account kinds (account_created, email_linked, avatar_set).
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
-- account whose balance the orders fully explain. `holdings` is
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
-- because db:push splits statements at a semicolon that ends a line.
create or replace function friends_cap() returns trigger language plpgsql as $$
begin perform pg_advisory_xact_lock(hashtextextended('friends:' || new.a_id::text, 0)); perform pg_advisory_xact_lock(hashtextextended('friends:' || new.b_id::text, 0)); if (select count(*) from friends where a_id = new.a_id or b_id = new.a_id) > 50 or (select count(*) from friends where a_id = new.b_id or b_id = new.b_id) > 50 then raise exception 'friends cap reached' using errcode = 'check_violation'; end if; return null; end $$;

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
