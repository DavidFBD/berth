import type { FriendsHolding, MostBoughtResponse } from "@/lib/social-proof";

/**
 * ?proof=1 on /dev/board (and on a home scene with &drawer=board): Most
 * bought on Berth this week as a busy week would show it, without a
 * database. ?proof=0 shows the quiet week, where it does not appear. The
 * friends' holdings fixture is for /dev/social's "Your friends hold".
 */
export const MOST_BOUGHT_FIXTURE: MostBoughtResponse = { days: 7, week: "2026-10-05", rows: [
  { symbol: "NVDA", people: 15, plus: true },
  { symbol: "TSLA", people: 10, plus: true },
  { symbol: "AAPL", people: 9, plus: false },
  { symbol: "QQQ", people: 6, plus: false },
  { symbol: "MSFT", people: 5, plus: false },
] };

export const FRIENDS_HOLDING_FIXTURE: FriendsHolding[] = [
  { symbol: "NVDA", count: 4, names: [] },
  { symbol: "AAPL", count: 2, names: ["harbour_light", "mara"] },
  { symbol: "TSLA", count: 1, names: ["quay_side"] },
];

/** What the gallery passes the board for a `proof` parameter: a fixture, an empty answer, or the live hook. */
export function socialProofFor(proof: string | null): { mostBought?: MostBoughtResponse } {
  if (proof === "1") return { mostBought: MOST_BOUGHT_FIXTURE };
  if (proof === "0") return { mostBought: { rows: [], days: 7 } };
  return {};
}
