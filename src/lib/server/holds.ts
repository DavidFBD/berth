import { erc20Abi, parseUnits, type Address } from "viem";
import { NOT_NO_XP } from "@/lib/server/no-xp";
import { getSql } from "@/lib/server/db";
import { awardXp } from "@/lib/server/accounts";
import { accountEvmAddresses } from "@/lib/server/identities";
import { hubWalletFor } from "@/lib/server/portfolio";
import { getSodax } from "@/lib/server/pour-verify";
import { readRobinhoodTokenBalances, type RobinhoodBalanceReader } from "@/lib/server/robinhood-balances";
import { TOKEN_LISTINGS } from "@/lib/listings";
import type { HoldingChain } from "@/lib/orders";
import { XP_ACTIONS } from "@/lib/xp";
import type { Hold } from "@/lib/profile-types";

/**
 * The thirty day hold check: the one reward in Berth that pays for patience.
 *
 * THE PRODUCT RULE. A buy is "still on the books" when, thirty days after it
 * filled, the balance of that listing at the wallet the buy was delivered
 * to (`orders.delivered_to`, the intent's dstAddress, exactly where the
 * fill's Transfer landed), on the chain it was delivered to
 * (`orders.holding_chain`), covers everything this account has already
 * been paid for holding there, plus this buy:
 *
 *   balanceOf(listing, delivered_to) on holding_chain >= sum(quantity of
 *     this account's buys of the same listing delivered to the same wallet
 *     on the same chain already stamped 'paid') + this buy's quantity
 *
 * On the hub (Sonic, `holding_chain` null or 'sonic') the token is the
 * listing's own address. On Robinhood Chain it is the listing's native
 * token there (`rhAddress`), read on 4663 (lib/server/robinhood-balances),
 * never the hub's record of the fill: a buy filled on Sonic whose delivery
 * never arrived in the wallet holds nothing there and is never paid
 * (plan P1b, "filled on the hub is not arrived on 4663").
 *
 * all in raw units (decimals 18). The accounting is cumulative: two 1 unit
 * buys with a balance of 1 pay once. Buys of one listing at one wallet that
 * fall due in the same run are judged oldest first, and an earlier one paid
 * in this run counts toward the later one's requirement.
 *
 * Owner: the account that placed the order (`orders.user_id`); only a row
 * with no user_id falls back to the account whose wallet paid for it.
 *
 * A buy with no recorded delivery wallet, or of an address that is no
 * listing this build knows (neither a token listing nor a vault in the SDK
 * registry), is unverifiable and never judged or listed. So is a buy held
 * on a chain this check cannot read (KNOWN_CHAIN), or held on Robinhood
 * Chain of a listing with no token there.
 * Held: `held_30_days` is awarded once, deduped by the buy's intent tx,
 * parked unannounced so the toast fires the next time the person looks,
 * and the order is stamped 'paid'. Not held: the order is stamped 'forfeit'
 * and pays nothing, ever; the verdict is final, except that a buy whose
 * reward is already in the ledger is always stamped 'paid'. A failed read
 * (RPC, a single balanceOf in the batch) is not a verdict: the row keeps no
 * outcome, is stamped as attempted so it queues behind never-tried rows,
 * and tomorrow's run tries again. Nothing is ever awarded or forfeited on
 * doubt.
 *
 * Shape: a pure core (`judgeHold`), the SQL (`holdCandidates`,
 * `pendingHolds`), and a thin IO edge (`readDeliveredBalances`) that is
 * injected, so the whole run is testable against PGlite without a chain.
 */

/** Thirty days, in hours: the one place the length of a hold is stated. */
export const HOLD_HOURS = 720;
const HOLD_MS = HOLD_HOURS * 60 * 60 * 1000;
/** Most candidates judged per run: one multicall, well inside maxDuration. */
export const HOLD_BATCH_LIMIT = 200;
const LISTING_DECIMALS = 18;

/**
 * The date a buy's thirty days count from: the fill when known, else the
 * placement, else the moment we wrote the row (which is never earlier than
 * the fill, so it can only make a hold wait longer, never pay early).
 */
const EFFECTIVE_AT = "coalesce(o.filled_at, o.placed_at, o.created_at)";

/**
 * Where a row's token sits, as the check reads it: `holding_chain`, null
 * meaning sonic (every row before Robinhood Chain delivery).
 */
const CHAIN_OF = (alias: string) => `coalesce(${alias}.holding_chain, 'sonic')`;

/**
 * Held on a chain readDeliveredBalances reads: the hub, or Robinhood Chain
 * (plan P1b lifted the P0b guard that kept Robinhood rows out until the
 * check could read 4663). Any other value is never judged.
 */
const KNOWN_CHAIN = (alias: string) => `${CHAIN_OF(alias)} in ('sonic', 'robinhood')`;

/**
 * A filled buy with a known delivery wallet, on a chain the check reads. Quantity on a buy is what the
 * fill delivered (lib/orders readOrder); a buy whose fill was never read has
 * no quantity, is not judged, and waits for saveOrder to complete it. A no
 * XP buy (lib/server/no-xp, reported from where Berth is not available) is
 * never judged: it earns no hold, whatever path recorded it.
 */
const FILLED_UNCHECKED_BUY = (robinhoodParam: number) => `o.direction = 'buy'
  and o.hold_checked_at is null
  and ${NOT_NO_XP("o")}
  and o.quantity is not null
  and o.quantity > 0
  and o.delivered_to is not null
  and o.delivered_to ~ '^0x[0-9a-f]{40}$'
  and ${KNOWN_CHAIN("o")}
  and (${CHAIN_OF("o")} = 'sonic' or lower(o.listing_address) = any($${robinhoodParam}::text[]))`;

/**
 * Who owns an order: the account that placed it, or, only for a row that
 * never learned its account, the account whose wallet paid.
 *
 * The null user_id branch matches the home address (users.wallet_address)
 * only, not every linked wallet (phase 2). Deliberately: every order since
 * the orders table began is recorded with its account (lib/server/orders),
 * and production held no order without one on 2026-09-29 (SELECT count(*)
 * from orders where user_id is null: 0). The branch is a legacy guard.
 */
const OWNER_JOIN = `join users u
    on (o.user_id is not null and u.id = o.user_id)
    or (o.user_id is null and u.wallet_address = o.wallet_address)`;

/**
 * Whether the owning account (`u`) has any order on Robinhood Chain
 * (`orders.holding_chain`): only such an account is judged ACCOUNT_WIDE
 * (review: the hold check must be as before with the switches off). Every
 * other account keeps the per delivery wallet rule on the hub, for every
 * listing, so a paid lot from a wallet it no longer links can never make
 * an honest holder forfeit.
 */
const ACCOUNT_ON_ROBINHOOD = `exists (select 1 from orders r
    where r.holding_chain = 'robinhood'
      and (r.user_id = u.id or (r.user_id is null and r.wallet_address = u.wallet_address)))`;

/** A listing this build knows. $N is the lowercased address list. */
const KNOWN_LISTING = (n: number) => `lower(o.listing_address) = any($${n}::text[])`;

export type HoldCandidate = {
  orderId: string;
  intentTx: string;
  userId: string;
  /** The owning account's users.wallet_address, for its linked wallets (Robinhood Chain rows). */
  userWallet?: string | null;
  /** The listing's Sonic address, whichever chain it is held on (orders.listing_address). */
  listingAddress: string;
  /** Where the buy was delivered, so where its balance is read. */
  holdingChain: HoldingChain;
  /**
   * The owning account has an order on Robinhood Chain (ACCOUNT_ON_ROBINHOOD):
   * only then is a listing with a token there judged ACCOUNT_WIDE. Absent
   * reads as false, the per delivery wallet rule.
   */
  onRobinhood?: boolean;
  /** The wallet the buy was delivered to, where its balance is read. */
  deliveredTo: string;
  /** Decimal units of the listing, as Postgres prints the numeric. */
  quantity: string;
  /**
   * Decimal units already paid for holding this listing at this wallet by
   * this account, before this run (sum of its 'paid' buys).
   */
  paidBefore: string;
  effectiveAt: Date;
};

/**
 * One balance to read: `listing`'s balanceOf at `holder`, on `chain`
 * (absent meaning the hub). `listing` is always the Sonic listing address;
 * on Robinhood Chain the reader reads that listing's token there.
 */
export type BalanceQuery = { holder: string; listing: string; chain?: HoldingChain };

/**
 * Reads raw balances, one per query, same order. null for a single read
 * that could not be answered; throwing means the whole batch is unknown.
 */
export type BalanceReader = (
  queries: readonly BalanceQuery[],
) => Promise<(bigint | null)[]>;

export type HoldVerdict = "paid" | "forfeit" | "retry";

/** A decimal quantity in raw units, or null when it cannot be read. */
function toRaw(quantity: string): bigint | null {
  try {
    return parseUnits(quantity, LISTING_DECIMALS);
  } catch {
    return null;
  }
}

/**
 * The rule itself, with nothing around it. `alreadyPaid` is the raw amount
 * of this listing at this wallet the account has already been paid for.
 * An unknown balance, or a quantity we cannot read, is a retry.
 */
export function judgeHold(
  quantity: string,
  balance: bigint | null,
  alreadyPaid: bigint = 0n,
): HoldVerdict {
  if (balance === null) return "retry";
  const needed = toRaw(quantity);
  // A quantity we cannot read is a data problem, not a verdict.
  if (needed === null || needed <= 0n) return "retry";
  return balance >= alreadyPaid + needed ? "paid" : "forfeit";
}

type CandidateRow = {
  id: string;
  intent_tx: string;
  user_id: string;
  user_wallet: string | null;
  listing_address: string;
  holding_chain: HoldingChain;
  delivered_to: string;
  quantity: string;
  on_robinhood: boolean | null;
  paid_before: string;
  effective_at: string | Date;
};

/**
 * What decides whether a buy can be judged: the listing addresses this
 * build knows, lowercased, and of those the ones with a token on Robinhood
 * Chain (a buy held there of any other listing cannot be read).
 */
export type HoldScope = { listingAddresses: readonly string[]; robinhoodListingAddresses?: readonly string[] };

/** The Sonic addresses, lowercased, of the listings with a token on Robinhood Chain. */
const ROBINHOOD_LISTING_ADDRESSES = TOKEN_LISTINGS.filter((listing) => listing.rhAddress).map((listing) =>
  listing.address.toLowerCase(),
);

/** The scope this build knows: pinned token listings and registry vaults. */
export function holdScope(): HoldScope {
  return {
    robinhoodListingAddresses: ROBINHOOD_LISTING_ADDRESSES,
    listingAddresses: [
      ...TOKEN_LISTINGS.map((listing) => listing.address.toLowerCase()),
      ...getSodax()
        .leverageYield.listVaults()
        .map((vault) => vault.vault.toLowerCase()),
    ],
  };
}

/**
 * Buys due for their check: filled, unchecked, delivered to a known wallet,
 * of a known listing, thirty days old by `now`, and owned by an account. An
 * order with no owning account is left alone rather than forfeited:
 * accounts are created on first sight and wallets are linked later, so "no
 * account yet" is never "no account ever". Never-attempted rows first, then
 * the least recently attempted, each oldest first, so a row whose read
 * always fails cannot starve the ones behind it.
 */
export const CANDIDATES_SQL = `select o.id, o.intent_tx, u.id as user_id, u.wallet_address as user_wallet,
       o.listing_address, ${CHAIN_OF("o")} as holding_chain, o.delivered_to, o.quantity::text as quantity,
       ${ACCOUNT_ON_ROBINHOOD} as on_robinhood,
       case when lower(o.listing_address) = any($5::text[]) and ${ACCOUNT_ON_ROBINHOOD} then
         -- A listing with a token on Robinhood Chain (ACCOUNT_WIDE): every
         -- paid buy of it by the account, on either chain, less what sells
         -- placed BEFORE this buy took out of those paid lots. A sell first
         -- spends the unpaid buys before it (forfeited or still waiting), so
         -- buying and selling the same amount again each month never eats
         -- into a paid lot (rh-final 1); a paid lot that was really sold
         -- before this buy no longer counts against it.
         greatest(0,
           (select coalesce(sum(p.quantity), 0) from orders p
             where p.direction = 'buy' and p.hold_outcome = 'paid'
               and lower(p.listing_address) = lower(o.listing_address)
               and (p.user_id = u.id or (p.user_id is null and p.wallet_address = u.wallet_address)))
           - greatest(0,
               (select coalesce(sum(s.quantity), 0) from orders s
                 where s.direction = 'sell' and s.quantity is not null
                   and lower(s.listing_address) = lower(o.listing_address)
                   and (s.user_id = u.id or (s.user_id is null and s.wallet_address = u.wallet_address))
                   and coalesce(s.placed_at, s.filled_at, s.created_at) < ${EFFECTIVE_AT})
               - (select coalesce(sum(b.quantity), 0) from orders b
                   where b.direction = 'buy' and b.id <> o.id and b.quantity is not null
                     and b.hold_outcome is distinct from 'paid'
                     and lower(b.listing_address) = lower(o.listing_address)
                     and (b.user_id = u.id or (b.user_id is null and b.wallet_address = u.wallet_address))
                     and coalesce(b.filled_at, b.placed_at, b.created_at) < ${EFFECTIVE_AT}))
         )::text
       else
         -- Any other listing: per delivery wallet on the hub, as always.
         (select coalesce(sum(p.quantity), 0)::text
            from orders p
           where p.direction = 'buy'
             and p.hold_outcome = 'paid'
             and lower(p.listing_address) = lower(o.listing_address)
             and ${CHAIN_OF("p")} = ${CHAIN_OF("o")}
             and p.delivered_to = o.delivered_to
             and (p.user_id = u.id
                  or (p.user_id is null and p.wallet_address = u.wallet_address)))
       end as paid_before,
       ${EFFECTIVE_AT} as effective_at
  from orders o
  ${OWNER_JOIN}
 where ${FILLED_UNCHECKED_BUY(5)}
   and ${KNOWN_LISTING(3)}
   and ${EFFECTIVE_AT} <= $1::timestamptz - make_interval(hours => $4::int)
 order by o.hold_attempted_at asc nulls first, ${EFFECTIVE_AT} asc, o.id asc
 limit $2`;

export async function holdCandidates(
  now: Date = new Date(),
  limit: number = HOLD_BATCH_LIMIT,
  scope: HoldScope = holdScope(),
): Promise<HoldCandidate[]> {
  const rows = (await getSql().query(CANDIDATES_SQL, [
    now.toISOString(),
    limit,
    scope.listingAddresses,
    HOLD_HOURS,
    scope.robinhoodListingAddresses ?? [],
  ])) as CandidateRow[];
  return rows.map((row) => ({
    orderId: row.id,
    intentTx: row.intent_tx,
    userId: row.user_id,
    userWallet: row.user_wallet,
    listingAddress: row.listing_address,
    holdingChain: row.holding_chain === "robinhood" ? "robinhood" : "sonic",
    onRobinhood: row.on_robinhood === true,
    deliveredTo: row.delivered_to,
    quantity: String(row.quantity),
    paidBefore: String(row.paid_before),
    effectiveAt: new Date(row.effective_at),
  }));
}

/**
 * The hub half: every balanceOf(listing, holder) in ONE multicall on the hub
 * client (Sonic, where a buy is delivered). A vault is its own share token,
 * so its balanceOf is the share balance. A single read that fails comes back
 * null for its row; a failed multicall comes back null for every row.
 */
const readHubBalances: BalanceReader = async (queries) => {
  if (queries.length === 0) return [];
  let results: readonly { status: string; result?: unknown }[];
  try {
    results = await getSodax().hubProvider.publicClient.multicall({
      allowFailure: true,
      contracts: queries.map((query) => ({
        address: query.listing as Address,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [query.holder as Address] as const,
      })),
    });
  } catch (error) {
    console.warn(
      "[holds] multicall failed, every balance unknown",
      error instanceof Error ? error.message : error,
    );
    return queries.map(() => null);
  }
  return queries.map((_, index) => {
    const result = results[index];
    return result && result.status === "success" ? BigInt(result.result as bigint) : null;
  });
};

const RH_ADDRESS_BY_LISTING: ReadonlyMap<string, string> = new Map(
  TOKEN_LISTINGS.flatMap((listing) => (listing.rhAddress ? [[listing.address.toLowerCase(), listing.rhAddress] as const] : [])),
);

/**
 * The IO edge: each query read on its own chain. Hub rows go to the hub
 * multicall (readHubBalances); Robinhood Chain rows read the listing's
 * token there (`rhAddress`) at the holder, through the server's Robinhood
 * Chain reader (lib/server/robinhood-balances), which never throws and
 * answers null for what it could not read. A Robinhood row of a listing
 * with no token there is null: unknown, never zero.
 */
export function deliveredBalancesReader(
  readRobinhood: RobinhoodBalanceReader = readRobinhoodTokenBalances,
  readHub: BalanceReader = readHubBalances,
): BalanceReader {
  return async (queries) => {
    if (queries.length === 0) return [];
    const out: (bigint | null)[] = queries.map(() => null);
    const hub = queries.flatMap((query, index) => ((query.chain ?? "sonic") === "sonic" ? [{ query, index }] : []));
    const robinhood = queries.flatMap((query, index) => {
      const token = query.chain === "robinhood" ? RH_ADDRESS_BY_LISTING.get(query.listing.toLowerCase()) : undefined;
      return token ? [{ holder: query.holder, token, index }] : [];
    });
    const [hubRead, robinhoodRead] = await Promise.all([
      hub.length > 0 ? readHub(hub.map(({ query }) => query)) : Promise.resolve([]),
      robinhood.length > 0
        ? readRobinhood(robinhood.map(({ holder, token }) => ({ holder, token }))).catch(() => robinhood.map(() => null))
        : Promise.resolve([]),
    ]);
    hub.forEach(({ index }, position) => {
      out[index] = hubRead[position] ?? null;
    });
    robinhood.forEach(({ index }, position) => {
      // A reverted balanceOf is unknown here: a hold is never judged on it.
      const value = robinhoodRead[position];
      out[index] = typeof value === "bigint" ? value : null;
    });
    return out;
  };
}

/** Every delivered balance, each on its own chain. */
export const readDeliveredBalances: BalanceReader = deliveredBalancesReader();

/**
 * ACCOUNT_WIDE (rh-server m2, rh-delta on 1e9a3d1). A listing with a token
 * on Robinhood Chain can sit in a hub wallet or in any of the person's own
 * wallets there, and one transfer, or a bridge between the two chains,
 * moves it. So a buy of such a listing, on either chain, is judged against
 * the account's whole holding of it: its hub wallets (each buy's delivery
 * wallet and the hub wallet of every EVM address linked now) plus every
 * EVM wallet linked to the account now on Robinhood Chain (a wallet since
 * unlinked counts for nobody here), against every paid buy of it on
 * either chain, less what sells placed before the buy took out of paid
 * lots (a sell spends unpaid buys first), so an honest holder who sold a
 * paid lot never forfeits a new buy, and buying and selling again never
 * eats into a paid lot. Moving tokens between the account's
 * places changes nothing; moving them out of the account forfeits, as
 * selling does. Chosen over reading Transfer logs since each fill: no log
 * scan over a month of blocks on the public RPC, and no window to game.
 * Every other listing (the vaults) is judged per delivery wallet on the
 * hub, as before, and so is every listing for an account with no order on
 * Robinhood Chain (ACCOUNT_ON_ROBINHOOD): with the switches off the check
 * is exactly the one before Robinhood Chain delivery.
 */
export type AccountWallets = (userId: string, usersWallet: string | null) => Promise<string[]>;
/** The hub wallets the given EVM addresses derive on the home chain (lib/server/portfolio hubWalletFor). */
export type HubWalletsOf = (addresses: readonly string[]) => Promise<string[]>;

const hubWalletsOfLinked: HubWalletsOf = async (addresses) => Promise.all(addresses.map((address) => hubWalletFor(address)));

const accountWallets: AccountWallets = async (userId, usersWallet) =>
  (await accountEvmAddresses(userId, usersWallet, { failClosed: true })).all;

export type HoldRunSummary = {
  /** Candidates looked at this run. */
  checked: number;
  paid: number;
  forfeited: number;
  /** Left for the next run: unknown balance or a failed write. */
  retried: number;
};

const balanceKey = (listing: string, holder: string, chain: HoldingChain = "sonic") =>
  `${chain}|${listing.toLowerCase()}|${holder.toLowerCase()}`;

/**
 * Stamp a verdict, once. A buy whose reward is already in the ledger is
 * stamped 'paid' whatever today's verdict says: the award may have
 * committed on an earlier run whose stamp failed.
 */
const STAMP_SQL = `update orders o
    set hold_checked_at = $2::timestamptz,
        hold_outcome = case
          when exists (select 1 from xp_events e
                        where e.kind = 'held_30_days' and e.ref = o.intent_tx)
          then 'paid' else $3::text end
  where o.id = $1 and o.hold_checked_at is null
  returning o.hold_outcome`;

/**
 * One run of the daily check. Every candidate ends in exactly one bucket.
 * The award comes before the stamp, and the award is idempotent by ref, so
 * a crash between the two only means the next run stamps what it already
 * paid for, never a second payout.
 */
export async function runHoldCheck({
  now = new Date(),
  readBalances = readDeliveredBalances,
  walletsOf = accountWallets,
  hubWalletsOf = hubWalletsOfLinked,
  limit = HOLD_BATCH_LIMIT,
  scope = holdScope(),
  deadline = Number.POSITIVE_INFINITY,
}: {
  now?: Date;
  readBalances?: BalanceReader;
  /** The account's EVM wallets linked now, where its holding is summed (ACCOUNT_WIDE). */
  walletsOf?: AccountWallets;
  /** Their hub wallets (ACCOUNT_WIDE). */
  hubWalletsOf?: HubWalletsOf;
  limit?: number;
  scope?: HoldScope;
  /**
   * Epoch ms past which no new group is judged (the morning run's budget
   * for this stage). A buy left unjudged is not stamped, so the next run
   * takes it first; nothing is half written.
   */
  deadline?: number;
} = {}): Promise<HoldRunSummary> {
  const candidates = await holdCandidates(now, limit, scope);
  const summary: HoldRunSummary = {
    checked: candidates.length,
    paid: 0,
    forfeited: 0,
    retried: 0,
  };
  if (candidates.length === 0) return summary;

  const sql = getSql();
  const retriedIds: string[] = [];
  const markAttempted = async () => {
    if (retriedIds.length === 0) return;
    try {
      await sql.query(
        `update orders set hold_attempted_at = $2::timestamptz where id = any($1::uuid[])`,
        [retriedIds, now.toISOString()],
      );
    } catch (error) {
      console.warn(
        "[holds] attempt not stamped",
        error instanceof Error ? error.message : error,
      );
    }
  };

  // Where each candidate's holding is read (ACCOUNT_WIDE): for a listing
  // with a token on Robinhood Chain, every place the account holds it now;
  // for any other, its delivery wallet on the hub.
  // Only for an account with an order on Robinhood Chain (ACCOUNT_ON_ROBINHOOD);
  // every other account is judged per delivery wallet, as before.
  const accountWide = new Set(scope.robinhoodListingAddresses ?? []);
  const wide = (candidate: HoldCandidate) =>
    candidate.onRobinhood === true && accountWide.has(candidate.listingAddress.toLowerCase());
  type Place = { holder: string; chain: HoldingChain };
  const placesOfAccount = new Map<string, { evm: string[]; hubs: string[] } | null>();
  for (const candidate of candidates) {
    if (!wide(candidate) || placesOfAccount.has(candidate.userId)) continue;
    try {
      const evm = (await walletsOf(candidate.userId, candidate.userWallet ?? null)).map((wallet) => wallet.toLowerCase());
      const hubs = (await hubWalletsOf(evm)).map((wallet) => wallet.toLowerCase());
      placesOfAccount.set(candidate.userId, { evm, hubs });
    } catch (error) {
      console.warn("[holds] account wallets unread, its buys retried", error instanceof Error ? error.message : error);
      placesOfAccount.set(candidate.userId, null);
    }
  }
  /** The group a buy is judged in: per account and listing (ACCOUNT_WIDE), else per delivery wallet on the hub. */
  const groupKey = (candidate: HoldCandidate) =>
    wide(candidate)
      ? `${candidate.userId}|${candidate.listingAddress.toLowerCase()}`
      : `${candidate.userId}|${balanceKey(candidate.listingAddress, candidate.deliveredTo, candidate.holdingChain)}`;
  const groupsDraft = new Map<string, HoldCandidate[]>();
  for (const candidate of candidates) {
    const key = groupKey(candidate);
    groupsDraft.set(key, [...(groupsDraft.get(key) ?? []), candidate]);
  }
  /** Every place a group's holding is read, or null when the account's wallets could not be read. */
  const placesOf = (group: readonly HoldCandidate[]): Place[] | null => {
    const first = group[0];
    if (!wide(first)) return [{ holder: first.deliveredTo.toLowerCase(), chain: first.holdingChain }];
    const account = placesOfAccount.get(first.userId);
    if (!account) return null;
    const hubs = new Set([
      ...account.hubs,
      ...group.filter((candidate) => candidate.holdingChain === "sonic").map((candidate) => candidate.deliveredTo.toLowerCase()),
    ]);
    return [
      ...[...hubs].map((holder) => ({ holder, chain: "sonic" as const })),
      ...account.evm.map((holder) => ({ holder, chain: "robinhood" as const })),
    ];
  };

  // One read per (listing, wallet, chain), however many buys share it.
  const queries = [
    ...new Map(
      [...groupsDraft.values()].flatMap((group) =>
        (placesOf(group) ?? []).map((place) => [
          balanceKey(group[0].listingAddress, place.holder, place.chain),
          { holder: place.holder, listing: group[0].listingAddress, chain: place.chain },
        ] as const),
      ),
    ).values(),
  ];
  const balances = new Map<string, bigint | null>();
  try {
    const read = await readBalances(queries);
    queries.forEach((query, index) =>
      balances.set(balanceKey(query.listing, query.holder, query.chain), read[index] ?? null),
    );
  } catch (error) {
    console.warn(
      "[holds] balance read failed, all retried",
      error instanceof Error ? error.message : error,
    );
    retriedIds.push(...candidates.map((candidate) => candidate.orderId));
    summary.retried = candidates.length;
    await markAttempted();
    return summary;
  }
  /** A group's holding summed over its places; null when any part is unknown. */
  const holdingOf = (group: readonly HoldCandidate[]): bigint | null => {
    const places = placesOf(group);
    if (!places) return null;
    let sum = 0n;
    for (const place of places) {
      const balance = balances.get(balanceKey(group[0].listingAddress, place.holder, place.chain));
      if (balance === null || balance === undefined) return null;
      sum += balance;
    }
    return sum;
  };

  // Cumulative accounting: one account's buys of one listing (per wallet
  // for a vault) are judged together, oldest first, each paid one raising
  // the bar.
  const groups = groupsDraft;

  for (const group of groups.values()) {
    if (Date.now() >= deadline) break;
    group.sort(
      (a, b) =>
        a.effectiveAt.getTime() - b.effectiveAt.getTime() ||
        (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0),
    );
    const balance = holdingOf(group);
    let alreadyPaid = toRaw(group[0].paidBefore);

    for (const candidate of group) {
      const verdict =
        alreadyPaid === null ? "retry" : judgeHold(candidate.quantity, balance, alreadyPaid);
      if (verdict === "retry") {
        summary.retried += 1;
        retriedIds.push(candidate.orderId);
        continue;
      }
      try {
        if (verdict === "paid") {
          await awardXp(candidate.userId, "held_30_days", candidate.intentTx, {
            announced: false,
          });
        }
        const stamped = (await sql.query(STAMP_SQL, [
          candidate.orderId,
          now.toISOString(),
          verdict,
        ])) as { hold_outcome: string }[];
        const outcome = stamped[0]?.hold_outcome ?? verdict;
        if (outcome === "paid") {
          summary.paid += 1;
          if (alreadyPaid !== null) alreadyPaid += toRaw(candidate.quantity) ?? 0n;
        } else {
          summary.forfeited += 1;
        }
      } catch (error) {
        console.warn(
          "[holds] verdict not written, retried",
          candidate.intentTx,
          error instanceof Error ? error.message : error,
        );
        summary.retried += 1;
        retriedIds.push(candidate.orderId);
      }
    }
  }
  await markAttempted();
  return summary;
}

const NAME_BY_ADDRESS: ReadonlyMap<string, string> = new Map(
  TOKEN_LISTINGS.map((listing) => [listing.address.toLowerCase(), listing.name]),
);

/**
 * The listing's plain name, or null. Only the static token listings carry a
 * real name; a vault's registry name is its share token symbol, which is a
 * ticker, so vaults and anything unknown answer null.
 */
export function holdListingName(address: string): string | null {
  return NAME_BY_ADDRESS.get(address.toLowerCase()) ?? null;
}

type PendingRow = {
  intent_tx: string;
  listing_address: string;
  effective_at: string | Date;
};

/**
 * The account's buys still waiting on their verdict, soonest due first:
 * exactly the rows the cron will judge (same filled-buy rule, same owner
 * join, same known-listing rule), including ones already due whose read
 * failed and will retry. An unverifiable buy is never listed, since no
 * verdict is ever coming for it.
 */
export async function pendingHolds(
  userId: string,
  scope: HoldScope = holdScope(),
): Promise<Hold[]> {
  const rows = (await getSql().query(
    `select o.intent_tx, o.listing_address, ${EFFECTIVE_AT} as effective_at
       from orders o
       ${OWNER_JOIN}
      where u.id = $1
        and ${FILLED_UNCHECKED_BUY(3)}
        and ${KNOWN_LISTING(2)}
      order by ${EFFECTIVE_AT} asc, o.id asc`,
    [userId, scope.listingAddresses, scope.robinhoodListingAddresses ?? []],
  )) as PendingRow[];
  const amount = XP_ACTIONS.held_30_days.amount;
  return rows.map((row) => {
    const poured = new Date(row.effective_at);
    return {
      ref: row.intent_tx,
      pouredAt: poured.toISOString(),
      dueAt: new Date(poured.getTime() + HOLD_MS).toISOString(),
      amount,
      name: holdListingName(row.listing_address),
    };
  });
}
