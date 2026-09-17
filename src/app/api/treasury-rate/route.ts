/**
 * The Treasury rate shown beside parked cash.
 *
 * SGOV holds 0 to 3 month US Treasury bills, so the honest number to show
 * is the 3 month bill rate itself, labelled as such and as "before fund
 * costs" (the fund's expense ratio comes off it). The Federal Reserve's FRED
 * series DTB3 (3-Month Treasury Bill Secondary Market Rate, Discount Basis,
 * daily) is public and keyless as a CSV. treasury.gov's own XML feed was
 * unreachable from here on 2026-09-17, so FRED is the source.
 *
 * Server-side, cached for six hours (the series updates once a business
 * day). Always 200: no rate is a soft degrade and the cash line simply
 * omits it.
 */

const FRED_DTB3_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTB3";
const REVALIDATE_SECONDS = 6 * 60 * 60;

export type TreasuryRateResponse = {
  /** Annualised percent, e.g. 3.97; null when unavailable. */
  ratePct: number | null;
  /** ISO date of the observation; null when unavailable. */
  asOf: string | null;
  source: "FRED DTB3";
  reason?: string;
};

export async function GET(): Promise<Response> {
  const payload: TreasuryRateResponse = {
    ratePct: null,
    asOf: null,
    source: "FRED DTB3",
  };
  try {
    const response = await fetch(FRED_DTB3_CSV, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      payload.reason = `FRED answered ${response.status}`;
      return Response.json(payload);
    }
    const csv = await response.text();
    // "observation_date,DTB3" header, then "YYYY-MM-DD,3.97"; a holiday is
    // "YYYY-MM-DD,." so walk back to the last real number.
    const lines = csv.trim().split("\n").slice(1).reverse();
    for (const line of lines) {
      const [date, value] = line.split(",");
      const rate = Number(value);
      if (date && value !== "." && Number.isFinite(rate) && rate >= 0) {
        payload.ratePct = rate;
        payload.asOf = date;
        break;
      }
    }
    if (payload.ratePct === null) payload.reason = "no observation in the series";
  } catch (error) {
    payload.reason =
      error instanceof Error ? error.message : "FRED request failed";
  }
  return Response.json(payload);
}
