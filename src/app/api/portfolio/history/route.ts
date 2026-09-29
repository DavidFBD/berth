import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_BENCHMARK, findBenchmark } from "@/lib/benchmarks";
import { accountEvmAddresses } from "@/lib/server/identities";
import { loadPortfolioHistory } from "@/lib/server/portfolio-view";
import { readRewardsCaller, resolveRewardsUser } from "@/lib/server/rewards-route";

export type { PortfolioHistoryResponse } from "@/lib/server/portfolio-view";

export const dynamic = "force-dynamic";

/**
 * The account's money over time beside the same money in a benchmark
 * (lib/server/portfolio-view has the reading, and the contract of every
 * field). Same proof of identity as /api/orders.
 *
 *   GET /api/portfolio/history?benchmark=SPY
 *   POST /api/portfolio/history?benchmark=SPY   (the same; the client's
 *        rewards request core only speaks POST, see hooks/use-profile)
 *
 * Never cached: the answer is one account's.
 */
export async function GET(request: NextRequest) {
  const read = await readRewardsCaller(request);
  if (!read.ok) return read.response;
  const resolved = await resolveRewardsUser(read.caller);
  if (!resolved.ok) return resolved.response;

  const asked = request.nextUrl.searchParams.get("benchmark") ?? DEFAULT_BENCHMARK;
  const benchmark = findBenchmark(asked);
  if (!benchmark) {
    return NextResponse.json({ error: "unknown benchmark" }, { status: 400 });
  }

  // Every EVM address linked to the account (each has its own hub wallet),
  // plus the caller's own as before: a Privy session's embedded wallet.
  const linked = await accountEvmAddresses(resolved.user.id, resolved.user.wallet_address);
  const own = read.caller.wallet ?? resolved.user.wallet_address;
  const spokes = [...new Set([...linked.all, ...(own && /^0x[0-9a-f]{40}$/.test(own) ? [own] : [])])];
  const response = await loadPortfolioHistory({
    userId: resolved.user.id,
    spokes,
    benchmark,
  });
  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}

/** The same read for the client's rewards request core, which always POSTs. */
export const POST = GET;
