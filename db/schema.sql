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
