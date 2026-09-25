/**
 * Fill table `marks` with every daily close DefiLlama still has, up to a
 * year back, for every listing and benchmark (lib/market-ids). The same
 * rules as the daily cron (lib/marks): 21:30 UTC points only, market days
 * only, despiked; a day with no clean mark stays empty. The Robinhood
 * tokens begin on 2026-06-26 (SGOV 2026-07-08); Gold and Bitcoin reach the
 * whole year. One request per symbol keeps inside DefiLlama's 500 point cap.
 * Safe to run again. Dry run by default; --write to save.
 *
 *   pnpm marks:backfill
 *   pnpm marks:backfill --write
 */
import "./lib/load-env.mjs";

const { MARKS_MARKET_ID_BY_SYMBOL } = await import("../src/lib/market-ids.ts");
const { addDays, onTheMark, settleMarks } = await import("../src/lib/marks.ts");
const { fetchMarkPoints, writeMarks } = await import("../src/lib/server/marks.ts");
const { getSql } = await import("../src/lib/server/db.ts");

const WRITE = process.argv.includes("--write");
const SPAN_DAYS = 366;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set; it is read from .env.local.");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const fromDay = addDays(today, -(SPAN_DAYS - 1));
const symbols = Object.keys(MARKS_MARKET_ID_BY_SYMBOL);
const { points, failures } = await fetchMarkPoints(symbols, fromDay, SPAN_DAYS);
for (const failure of failures) console.warn("failed:", failure);

let written = 0;
let dropped = 0;
for (const symbol of symbols) {
  const raw = points[symbol] ?? [];
  const aligned = onTheMark(raw);
  const { keep, drop } = settleMarks(aligned, fromDay);
  console.log(
    `${symbol.padEnd(5)} ${String(raw.length).padStart(3)} points, ${String(aligned.length).padStart(3)} at the close,` +
      ` ${String(keep.length).padStart(3)} market day closes kept (${keep[0]?.day ?? "-"} to ${keep.at(-1)?.day ?? "-"}), ${drop.length} despiked`,
  );
  if (WRITE) await writeMarks(symbol, keep, drop);
  written += keep.length;
  dropped += drop.length;
}

if (WRITE) {
  const [{ rows }] = await getSql().query("select count(*)::int as rows from marks");
  console.log(`written ${written}, despiked ${dropped}; marks now holds ${rows} rows`);
} else {
  console.log(`dry run: would write ${written}, despike ${dropped}; add --write to save`);
}
