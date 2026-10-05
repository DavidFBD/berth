import { switchedOn } from "@/lib/limit-orders";

/**
 * The Robinhood Chain delivery switch: `ROBINHOOD_DELIVERY_USERS`, a comma
 * separated list of Berth user ids or wallet addresses (lib/limit-orders
 * switchedOn, the same reading as LIMIT_ORDERS_USERS). Unset or empty
 * switches nobody on, which is how it ships: every buy then delivers to the
 * hub exactly as before. Read server side on every call and never through a
 * NEXT_PUBLIC_ variable; the browser learns its own answer from
 * app/api/delivery and nothing about anyone else.
 */
export function robinhoodDeliveryOn(identifiers: readonly (string | null | undefined)[]): boolean {
  return switchedOn(process.env.ROBINHOOD_DELIVERY_USERS, identifiers);
}
