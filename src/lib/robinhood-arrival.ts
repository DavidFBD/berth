/**
 * Where a buy delivered to Robinhood Chain stands after its hub fill
 * (hooks/use-robinhood-arrival), from what was actually seen. Pure.
 *
 * - `off`: not such a buy, or not filled yet.
 * - `arriving`: filled on the hub, no sign yet on Robinhood Chain.
 * - `arrived`: the relay named the delivery transaction there, or the
 *   wallet's balance of the token rose above what it held before.
 * - `slow`: neither inside the wait. Not a failure: the delivery runs
 *   without the page, and the screen says so.
 */
export type ArrivalState =
  | { kind: "off" }
  | { kind: "arriving" }
  | { kind: "arrived"; deliveryTx?: string }
  | { kind: "slow" };

export function arrivalState({
  enabled,
  deliveryTx,
  balance,
  baseline,
  waitedOut,
}: {
  enabled: boolean;
  deliveryTx: string | undefined;
  balance: bigint | undefined;
  baseline: bigint | undefined;
  waitedOut: boolean;
}): ArrivalState {
  if (!enabled) return { kind: "off" };
  if (deliveryTx) return { kind: "arrived", deliveryTx };
  if (balance !== undefined && baseline !== undefined && balance > baseline) return { kind: "arrived" };
  return waitedOut ? { kind: "slow" } : { kind: "arriving" };
}
