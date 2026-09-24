import { erc20Abi, parseUnits, type Address } from "viem";
import { getSql } from "@/lib/server/db";
import { awardXp } from "@/lib/server/accounts";
import { getSodax } from "@/lib/server/pour-verify";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { XP_ACTIONS } from "@/lib/xp";
import type { Hold } from "@/lib/profile-types";

/**
 * The thirty day hold check: the one reward in Berth that pays for patience.
 *
 * THE PRODUCT RULE. A buy is "still on the books" when, thirty days after it
 * filled, the balance of that listing at the wallet the buy was delivered
 * to (`orders.delivered_to`, the intent's dstAddress, exactly where the
 * fill's Transfer landed) covers everything this account has already been
 * paid for holding there, plus this buy:
 *
 *   balanceOf(listing, delivered_to) >= sum(quantity of this account's buys
 *     of the same listing delivered to the same wallet already stamped
 *     'paid') + this buy's quantity
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
 * registry), is unverifiable and never judged or listed.
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
 * A filled buy with a known delivery wallet. Quantity on a buy is what the
 * fill delivered (lib/orders readOrder); a buy whose fill was never read has
 * no quantity, is not judged, and waits for saveOrder to complete it.
 */
const FILLED_UNCHECKED_BUY = `o.direction = 'buy'
  and o.hold_checked_at is null
  and o.quantity is not null
  and o.quantity > 0
  and o.delivered_to is not null
  and o.delivered_to ~ '^0x[0-9a-f]{40}$'`;

/**
 * Who owns an order: the account that placed it, or, only for a row that
 * never learned its account, the account whose wallet paid.
 */
const OWNER_JOIN = `join users u
    on (o.user_id is not null and u.id = o.user_id)
    or (o.user_id is null and u.wallet_address = o.wallet_address)`;

/** A listing this build knows. $N is the lowercased address list. */
const KNOWN_LISTING = (n: number) => `lower(o.listing_address) = any($${n}::text[])`;

export type HoldCandidate = {
  orderId: string;
  intentTx: string;
  userId: string;
  listingAddress: string;
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

/** One balance to read: `listing`'s balanceOf at `holder`. */
export type BalanceQuery = { holder: string; listing: string };

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
  listing_address: string;
  delivered_to: string;
  quantity: string;
  paid_before: string;
  effective_at: string | Date;
};

/** What decides whether a buy can be judged: the listing addresses this build knows, lowercased. */
export type HoldScope = { listingAddresses: readonly string[] };

/** The scope this build knows: pinned token listings and registry vaults. */
export function holdScope(): HoldScope {
  return {
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
export const CANDIDATES_SQL = `select o.id, o.intent_tx, u.id as user_id,
       o.listing_address, o.delivered_to, o.quantity::text as quantity,
       (select coalesce(sum(p.quantity), 0)::text
          from orders p
         where p.direction = 'buy'
           and p.hold_outcome = 'paid'
           and lower(p.listing_address) = lower(o.listing_address)
           and p.delivered_to = o.delivered_to
           and (p.user_id = u.id
                or (p.user_id is null and p.wallet_address = u.wallet_address))
       ) as paid_before,
       ${EFFECTIVE_AT} as effective_at
  from orders o
  ${OWNER_JOIN}
 where ${FILLED_UNCHECKED_BUY}
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
  ])) as CandidateRow[];
  return rows.map((row) => ({
    orderId: row.id,
    intentTx: row.intent_tx,
    userId: row.user_id,
    listingAddress: row.listing_address,
    deliveredTo: row.delivered_to,
    quantity: String(row.quantity),
    paidBefore: String(row.paid_before),
    effectiveAt: new Date(row.effective_at),
  }));
}

/**
 * The IO edge: every balanceOf(listing, holder) in ONE multicall on the hub
 * client (Sonic, where a buy is delivered). A vault is its own share token,
 * so its balanceOf is the share balance. A single read that fails comes back
 * null for its row; a failed multicall comes back null for every row.
 */
export const readDeliveredBalances: BalanceReader = async (queries) => {
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

export type HoldRunSummary = {
  /** Candidates looked at this run. */
  checked: number;
  paid: number;
  forfeited: number;
  /** Left for the next run: unknown balance or a failed write. */
  retried: number;
};

const balanceKey = (listing: string, holder: string) =>
  `${listing.toLowerCase()}|${holder.toLowerCase()}`;

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
  limit = HOLD_BATCH_LIMIT,
  scope = holdScope(),
}: {
  now?: Date;
  readBalances?: BalanceReader;
  limit?: number;
  scope?: HoldScope;
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

  // One read per (listing, wallet), however many buys share it.
  const queries = [
    ...new Map(
      candidates.map((candidate) => [
        balanceKey(candidate.listingAddress, candidate.deliveredTo),
        { holder: candidate.deliveredTo, listing: candidate.listingAddress },
      ]),
    ).values(),
  ];
  const balances = new Map<string, bigint | null>();
  try {
    const read = await readBalances(queries);
    queries.forEach((query, index) =>
      balances.set(balanceKey(query.listing, query.holder), read[index] ?? null),
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

  // Cumulative accounting: one account's buys of one listing at one wallet
  // are judged together, oldest first, each paid one raising the bar.
  const groups = new Map<string, HoldCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.userId}|${balanceKey(candidate.listingAddress, candidate.deliveredTo)}`;
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }

  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        a.effectiveAt.getTime() - b.effectiveAt.getTime() ||
        (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0),
    );
    const balance =
      balances.get(balanceKey(group[0].listingAddress, group[0].deliveredTo)) ?? null;
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
        and ${FILLED_UNCHECKED_BUY}
        and ${KNOWN_LISTING(2)}
      order by ${EFFECTIVE_AT} asc, o.id asc`,
    [userId, scope.listingAddresses],
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
