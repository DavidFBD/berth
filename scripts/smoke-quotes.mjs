// pnpm smoke:quotes: the live quote smoke of the core money journey.
// Quotes only: no wallet, no signing, no sends. The pairs and the verdict
// live in src/lib/quote-smoke.ts, shared with the /api/cron/canary route.
//
//   pnpm smoke:quotes                       # 16 quick pairs + a crypto control, via www.berthmarkets.com
//   pnpm smoke:quotes --full                # the whole matrix (15 pay sources x 4 stocks x 3 sizes, every sell)
//   pnpm smoke:quotes --base http://localhost:3000   # another deployment's proxy (a preview, local)
//   pnpm smoke:quotes --direct              # api.sodax.com, no proxy (keyless)
//   pnpm smoke:quotes --json out.json       # every row as JSON
//   pnpm smoke:quotes --no-retry            # skip the 20 s retry of failing pairs
//
// It goes through the same SDK call as the drawers (sodax.swaps.getQuote with
// the pre-fee amount and the app's sodaxConfig), pointed at the production
// proxy unless told otherwise, so it asks exactly what a person's browser asks.
//
// Exit codes: 0 every pair quoted (flapping pairs reported apart); 2 only
// stock routes refused with the solver's -4 while the crypto control quoted
// (solver side: pnpm verify --solver-down-ack may proceed, logged); 1 any
// other failure.
import { Sodax } from "@sodax/sdk";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const full = flag("--full");
const direct = flag("--direct");
const base = (value("--base") ?? process.env.BERTH_ORIGIN ?? "https://www.berthmarkets.com").replace(/\/$/, "");
const jsonOut = value("--json");
const retryDelayMs = flag("--no-retry") ? -1 : Number(process.env.SMOKE_RETRY_MS ?? 20_000);

const root = process.cwd();
const { sodaxConfig } = await import(`${root}/src/lib/sodax-config.ts`);
const smoke = await import(`${root}/src/lib/quote-smoke.ts`);

const endpoint = direct ? "https://api.sodax.com/v1/intent" : `${base}/api/sodax/intent`;
const sodax = new Sodax({ ...sodaxConfig, solver: { ...sodaxConfig.solver, solverApiEndpoint: endpoint } });
const init = await sodax.initialize?.();
if (init && !init.ok) console.error("smoke: SDK initialize failed, static config used:", init.error?.message ?? init.error);

const started = Date.now();
let prices;
try {
  prices = await smoke.fetchHubPrices();
} catch (error) {
  console.error(`smoke: FAILED. The hub oracle did not answer (${error.message}); no quote can be priced.`);
  process.exit(1);
}

const jobs = smoke.smokeJobs({ full, tokenOn: smoke.sdkTokenLookup(sodax), prices });
console.log(`smoke: ${jobs.length} quotes (${full ? "full" : "quick"}) via ${direct ? "api.sodax.com (direct)" : endpoint}`);
const rows = await smoke.runSmoke({
  jobs,
  ask: (job) => smoke.quoteOnce(sodax, job),
  retryDelayMs,
  // The full matrix is about 250 quotes on the house key: four at a time, a quarter second apart.
  concurrency: full ? 4 : 8,
  gapMs: full ? 250 : 0,
  onRetry: (count) => console.log(`smoke: ${count} failed, asking ${count === 1 ? "it" : "them"} once more in ${Math.round(retryDelayMs / 1000)} s`),
});
const result = smoke.smokeVerdict(rows);

console.log("");
console.log(smoke.smokeTable(rows, { all: !full }));
console.log("");
for (const row of result.failed.slice(0, 5)) {
  if (row.final.message) console.log(`  ${row.src} -> ${row.dst}: ${row.final.message}`);
}
console.log(`smoke: ${result.verdict.toUpperCase()} in ${Math.round((Date.now() - started) / 1000)} s. ${result.summary}`);
if (jsonOut) (await import("node:fs")).writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), endpoint, full, ...result, rows }, null, 1));
process.exit(result.verdict === "pass" ? 0 : result.verdict === "solver_down" ? 2 : 1);
