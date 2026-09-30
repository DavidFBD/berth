/**
 * The names of the thirteen Berth tools (lib/server/berth-tools/registry), in
 * a module the client may import: the chat's tool lines are copy keyed on
 * these. A test holds the registry to this list.
 */
export const BERTH_TOOL_NAMES = [
  "list_listings",
  "get_listing",
  "get_moves",
  "get_market_feed",
  "get_account",
  "get_holdings",
  "get_performance",
  "get_orders",
  "get_my_profile",
  "get_friends_board",
  "draft_order",
  "list_recurring",
  "draft_recurring",
] as const;

export type BerthToolName = (typeof BERTH_TOOL_NAMES)[number];

export function isBerthToolName(value: string): value is BerthToolName {
  return (BERTH_TOOL_NAMES as readonly string[]).includes(value);
}
