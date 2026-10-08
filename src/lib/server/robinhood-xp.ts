import { parseUnits } from "viem";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { getSql } from "@/lib/server/db";
import { readRobinhoodTokenBalances, type RobinhoodBalanceReader } from "@/lib/server/robinhood-balances";

/**
 * When an order on Robinhood Chain earns its pour XP (owner decisions D1 and
 * D2, 8 October). Every other order earns as before.
 *
 * D1, a buy delivered there: paid only once the delivery is seen in the
 * wallet, `balanceOf(rhAddress, delivered_to)` on Robinhood Chain at least
 * the quantity the fill delivered. The hub's fill proves the solver filled
 * on Sonic, not that the asset manager delivered on 4663. Until then the
 * buy waits (its claim stays open and the evening pass asks again); a
 * delivery that never arrives is never paid. A wallet that already held
 * the listing can read as arrived early: the rule is the owner's, kept
 * plain.
 *
 * D2, a sell from there: paid only while the account's recorded Berth
 * buys delivered there of that listing, placed no later than the sell,
 * cover this sell on top of every earlier sell from there that was paid.
 * Tokens bought outside Berth and sold through it earn nothing (this also
 * answers rh-server m3: dust sells of outside tokens farm nothing).
 *
 * Read from the order row (lib/server/orders), so the pour route and the
 * evening pass (lib/server/pour-claims payClaim) judge alike.
 */

/** `pay`: earns now. `wait`: not yet (a buy not seen in the wallet). `never`: earns nothing, then or ever. */
export type PourXpVerdict = "pay" | "wait" | "never";

const RH_ADDRESS_BY_LISTING: ReadonlyMap<string, string> = new Map(
  TOKEN_LISTINGS.flatMap((listing) => (listing.rhAddress ? [[listing.address.toLowerCase(), listing.rhAddress] as const] : [])),
);

type OrderRow = {
  user_id: string | null;
  direction: "buy" | "sell";
  holding_chain: string | null;
  listing_address: string;
  delivered_to: string | null;
  quantity: string | null;
  at: string | Date;
};

const DECIMALS = 18;

function raw(quantity: string | null): bigint | null {
  if (quantity === null) return null;
  try {
    return parseUnits(quantity, DECIMALS);
  } catch {
    return null;
  }
}

/**
 * The verdict for one recorded order. `onRobinhood` is what the intent
 * says (lib/orders holdingChainOf): an order there whose row is not written
 * yet waits; an order on the hub with no row pays as before.
 */
export async function robinhoodPourXp(
  intentTx: string,
  {
    onRobinhood,
    readBalances = readRobinhoodTokenBalances,
  }: { onRobinhood: boolean; readBalances?: RobinhoodBalanceReader },
): Promise<PourXpVerdict> {
  const rows = (await getSql().query(
    `select user_id, direction, holding_chain, listing_address, delivered_to, quantity::text as quantity,
            coalesce(placed_at, created_at) as at
       from orders where intent_tx = $1 limit 1`,
    [intentTx.toLowerCase()],
  )) as OrderRow[];
  const row = rows[0];
  if (!row) return onRobinhood ? "wait" : "pay";
  if (row.holding_chain !== "robinhood") return "pay";
  return row.direction === "buy" ? buyArrived(row, readBalances) : sellCovered(intentTx.toLowerCase(), row);
}

/** D1: the delivered quantity is in the wallet it was delivered to. */
async function buyArrived(row: OrderRow, readBalances: RobinhoodBalanceReader): Promise<PourXpVerdict> {
  const token = RH_ADDRESS_BY_LISTING.get(row.listing_address.toLowerCase());
  if (!token || !row.delivered_to) return "never";
  const needed = raw(row.quantity);
  // The fill's quantity not read yet: nothing to compare.
  if (needed === null || needed <= 0n) return "wait";
  const [balance] = await readBalances([{ holder: row.delivered_to, token }]).catch(() => [null]);
  if (typeof balance !== "bigint") return "wait";
  return balance >= needed ? "pay" : "wait";
}

/** D2: the account's Berth buys delivered there cover this sell beside every earlier paid one. */
async function sellCovered(intentTx: string, row: OrderRow): Promise<PourXpVerdict> {
  const sold = raw(row.quantity);
  if (!row.user_id || sold === null || sold <= 0n) return "never";
  const sums = (await getSql().query(
    `select
       (select coalesce(sum(b.quantity), 0)::text from orders b
         where b.user_id = $1 and b.direction = 'buy' and b.holding_chain = 'robinhood'
           and lower(b.listing_address) = lower($2) and b.quantity is not null
           and coalesce(b.placed_at, b.created_at) <= $3::timestamptz) as bought,
       (select coalesce(sum(s.quantity), 0)::text from orders s
         where s.user_id = $1 and s.direction = 'sell' and s.holding_chain = 'robinhood'
           and lower(s.listing_address) = lower($2) and s.intent_tx <> $4
           and coalesce(s.placed_at, s.created_at) <= $3::timestamptz
           and exists (select 1 from xp_events e where e.kind = 'pour_out' and lower(e.ref) = lower(s.intent_tx))) as paid_sold`,
    [row.user_id, row.listing_address, new Date(row.at).toISOString(), intentTx],
  )) as { bought: string; paid_sold: string }[];
  const bought = raw(sums[0]?.bought ?? "0") ?? 0n;
  const paidSold = raw(sums[0]?.paid_sold ?? "0") ?? 0n;
  return paidSold + sold <= bought ? "pay" : "never";
}
