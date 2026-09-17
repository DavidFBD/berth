/**
 * What counts as dust.
 *
 * A holding worth less than a fraction of a cent is not a holding a person
 * can act on: withdrawing it costs more in network fees than it returns, and
 * listing it invites someone to try. The funds sweep has hidden and
 * discounted residue on this rule since it shipped; the vault list did not,
 * which is why a sub-cent leftover position kept its own titled section on
 * the account rail, with a Withdraw button that would have cost real money
 * to press.
 *
 * An unknown value is never dust. A holding the oracle cannot price yet is
 * one whose worth we do not know, and hiding money because a price request
 * is in flight is the one failure this rule must not have.
 */

/** Below this, in US dollars, a priced holding is residue. */
export const DUST_USD = 0.1;

export function isDust(usdValue: number | undefined): boolean {
  return usdValue !== undefined && usdValue < DUST_USD;
}
