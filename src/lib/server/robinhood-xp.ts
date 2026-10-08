import { parseUnits } from "viem";
import { TOKEN_LISTINGS } from "@/lib/listings";
import { getSql, inTransaction } from "@/lib/server/db";
import { NOT_NO_XP } from "@/lib/server/no-xp";
import { XP_ACTIONS } from "@/lib/xp";
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
 * D2, a sell from there (payRobinhoodSell): paid only while the account's recorded Berth
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
  // A sell is checked and paid in one step (payRobinhoodSell).
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

/**
 * D2 for one recorded sell from Robinhood Chain, checked and paid in one
 * step: the sell earns pour_out only while the account's Berth buys of that
 * listing delivered there (recorded, quantity read, not a no XP buy, which
 * includes a delivery that never arrived), placed no later than the sell,
 * cover it beside EVERY other paid sell from there of that listing,
 * whenever it was placed (rh-delta: a later sell reported first must not
 * leave room for an earlier one). The check and the award run in one
 * transaction behind `pg_advisory_xact_lock` on (account, listing), so
 * sells reported at once are judged one after another, never all against
 * the same room. While any such buy's quantity is still unread the answer
 * is `wait`: a sell judged then could be refused for good.
 *
 * `paid` also covers a replay of a sell already paid. Throws on a failed
 * read or write, which leaves the claim for the evening pass.
 */
export async function payRobinhoodSell(
  intentTx: string,
  { userId, announced = true }: { userId: string; announced?: boolean },
): Promise<{ verdict: PourXpVerdict | "paid"; awarded: number; xp: number | null }> {
  const tx = intentTx.toLowerCase();
  const rows = (await getSql().query(
    `select s.listing_address
       from orders s
      where s.intent_tx = $1 and s.user_id = $2 and s.direction = 'sell' and s.holding_chain = 'robinhood'
        and s.quantity is not null and s.quantity > 0`,
    [tx, userId],
  )) as { listing_address: string }[];
  const sell = rows[0];
  if (!sell) return { verdict: "never", awarded: 0, xp: null };
  const [, award] = await inTransaction([
    { text: `select pg_advisory_xact_lock(hashtextextended($1 || '|' || lower($2), 0))`, params: [userId, sell.listing_address] },
    {
      text: `with s as (
               select user_id, listing_address, quantity, coalesce(placed_at, created_at) as at
                 from orders where intent_tx = $1 and user_id = $2
             ), cover as (
               select (
                 (select coalesce(sum(b.quantity), 0) from orders b, s
                   where b.user_id = s.user_id and b.direction = 'buy' and b.holding_chain = 'robinhood'
                     and lower(b.listing_address) = lower(s.listing_address) and b.quantity is not null
                     and ${NOT_NO_XP("b")}
                     and coalesce(b.placed_at, b.created_at) <= s.at)
                 - (select coalesce(sum(o.quantity), 0) from orders o, s
                     where o.user_id = s.user_id and o.direction = 'sell' and o.holding_chain = 'robinhood'
                       and lower(o.listing_address) = lower(s.listing_address) and o.intent_tx <> $1
                       and exists (select 1 from xp_events e where e.kind = 'pour_out' and lower(e.ref) = lower(o.intent_tx)))
                 - (select quantity from s)
               ) >= 0 as ok
             ), unread as (
               -- Read under the lock (rh-final 2): a Berth buy there whose
               -- quantity is not read yet makes the answer wait, never no.
               select exists (select 1 from orders b, s
                 where b.user_id = s.user_id and b.direction = 'buy' and b.holding_chain = 'robinhood'
                   and lower(b.listing_address) = lower(s.listing_address) and b.quantity is null
                   and ${NOT_NO_XP("b")}
                   and coalesce(b.placed_at, b.created_at) <= s.at) as pending
             ), already as (
               select exists (select 1 from xp_events e where e.kind = 'pour_out' and lower(e.ref) = $1) as paid
             ), ins as (
               insert into xp_events (user_id, kind, amount, ref, announced)
               select $2, 'pour_out', $3, $1, $4
                where (select ok from cover) and not (select paid from already) and not (select pending from unread)
               on conflict do nothing
               returning amount
             )
             update users set xp = xp + coalesce((select amount from ins), 0), updated_at = now()
              where id = $2
             returning xp, coalesce((select amount from ins), 0) as awarded,
                       (select ok from cover) as ok, (select paid from already) as paid, (select pending from unread) as unread`,
      params: [tx, userId, XP_ACTIONS.pour_out.amount, announced],
    },
  ]);
  const result = (award as { xp: number; awarded: number; ok: boolean; paid: boolean; unread: boolean }[])[0];
  if (!result) return { verdict: "never", awarded: 0, xp: null };
  if (result.paid || result.awarded > 0) return { verdict: "paid", awarded: result.awarded, xp: result.xp };
  if (result.unread) return { verdict: "wait", awarded: 0, xp: null };
  return { verdict: result.ok ? "paid" : "never", awarded: 0, xp: result.xp };
}
