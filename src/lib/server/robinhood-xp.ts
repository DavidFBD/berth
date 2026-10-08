import { parseUnits } from "viem";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { getSql } from "@/lib/server/db";
import { readRobinhoodTokenBalances, type RobinhoodBalanceReader } from "@/lib/server/robinhood-balances";

/**
 * When an order on Robinhood Chain earns its pour XP (owner decision D1,
 * 8 October). Every other order earns as before.
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
  return row.direction === "buy" ? buyArrived(row, readBalances) : "pay";
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
