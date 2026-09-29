/**
 * The names of the eleven Berth tools (lib/server/berth-tools/registry), in
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
] as const;

export type BerthToolName = (typeof BERTH_TOOL_NAMES)[number];

export function isBerthToolName(value: string): value is BerthToolName {
  return (BERTH_TOOL_NAMES as readonly string[]).includes(value);
}
